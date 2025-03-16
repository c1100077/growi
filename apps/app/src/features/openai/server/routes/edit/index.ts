import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler, Response } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { MessageDelta } from 'openai/resources/beta/threads/messages.mjs';
import { z } from 'zod';

// Necessary imports
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { LlmEditorAssistantDiffSchema, LlmEditorAssistantMessageSchema } from '../../../interfaces/editor-assistant/llm-response-schemas';
import type { SseDetectedDiff, SseFinalized, SseMessage } from '../../../interfaces/editor-assistant/sse-schemas';
import { MessageErrorCode } from '../../../interfaces/message-error';
import { getOrCreateEditorAssistant } from '../../services/assistant';
import { openaiClient } from '../../services/client';
import { LlmResponseStreamProcessor } from '../../services/editor-assistant';
import { getStreamErrorCode } from '../../services/getStreamErrorCode';
import { getOpenaiService } from '../../services/openai';
import { replaceAnnotationWithPageLink } from '../../services/replace-annotation-with-page-link';
import { certifyAiService } from '../middlewares/certify-ai-service';
import { SseHelper } from '../utils/sse-helper';


const logger = loggerFactory('growi:routes:apiv3:openai:message');

// -----------------------------------------------------------------------------
// Type definitions
// -----------------------------------------------------------------------------

const LlmEditorAssistantResponseSchema = z.object({
  contents: z.array(z.union([LlmEditorAssistantMessageSchema, LlmEditorAssistantDiffSchema])),
}).describe('The response format for the editor assistant');


type ReqBody = {
  userMessage: string,
  markdown: string,
  aiAssistantId?: string,
  threadId?: string,
}

type Req = Request<undefined, Response, ReqBody> & {
  user: IUserHasId,
}


// -----------------------------------------------------------------------------
// Endpoint handler factory
// -----------------------------------------------------------------------------

type PostMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

/**
 * Create endpoint handlers for editor assistant
 */
export const postMessageToEditHandlersFactory: PostMessageHandlersFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  // Validator setup
  const validator: ValidationChain[] = [
    body('userMessage')
      .isString()
      .withMessage('userMessage must be string')
      .notEmpty()
      .withMessage('userMessage must be set'),
    body('markdown')
      .isString()
      .withMessage('markdown must be string')
      .notEmpty()
      .withMessage('markdown must be set'),
    body('aiAssistantId').optional().isMongoId().withMessage('aiAssistantId must be string'),
    body('threadId').optional().isString().withMessage('threadId must be string'),
  ];

  return [
    accessTokenParser, loginRequiredStrictly, certifyAiService, validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const { userMessage, markdown, threadId } = req.body;

      // Parameter check
      if (threadId == null) {
        return res.apiv3Err(new ErrorV3('threadId is not set', MessageErrorCode.THREAD_ID_IS_NOT_SET), 400);
      }

      // Service check
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      // Initialize SSE helper and stream processor
      const sseHelper = new SseHelper(res);
      const streamProcessor = new LlmResponseStreamProcessor({
        messageCallback: (appendedMessage) => {
          sseHelper.writeData<SseMessage>({ appendedMessage });
        },
        diffDetectedCallback: (detected) => {
          sseHelper.writeData<SseDetectedDiff>({ diff: detected });
        },
        dataFinalizedCallback: (message, replacements) => {
          sseHelper.writeData<SseFinalized>({ finalized: { message: message ?? '', replacements } });
        },
      });

      try {
        // Set response headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream;charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        });

        let rawBuffer = '';

        // Get assistant and process thread
        const assistant = await getOrCreateEditorAssistant();
        const thread = await openaiClient.beta.threads.retrieve(threadId);

        // Create stream
        /* eslint-disable max-len */
        const stream = openaiClient.beta.threads.runs.stream(thread.id, {
          assistant_id: assistant.id,
          additional_messages: [
            {
              role: 'assistant',
              content: `You are an Editor Assistant for GROWI, a markdown wiki system.
              Your task is to help users edit their markdown content based on their requests.

              RESPONSE FORMAT:
              You must respond with a JSON object in the following format example:
              {
                "contents": [
                  { "message": "Your brief message about the upcoming change or proposal.\n\n" },
                  { "retain": 10 },
                  { "insert": "New text 1" },
                  { "message": "Additional explanation if needed" },
                  { "retain": 100 },
                  { "delete": 15 },
                  { "insert": "New text 2" },
                  ...more items if needed
                  { "message": "Your friendly message explaining what changes were made or suggested." }
                ]
              }

              The array should contain:
              - [At the beginning of the list] A "message" object that has your brief message about the upcoming change or proposal. Be sure to add two consecutive line feeds ('\n\n') at the end.
              - Objects with a "message" key for explanatory text to the user if needed.
              - Objects with "insert", "delete", and "retain" keys for replacements (Delta format by Quill Rich Text Editor)
              - [At the end of the list] A "message" object that contains your friendly message explaining that the operation was completed and what changes were made.

              If no changes are needed, include only message objects with explanations.
              Always provide messages in the same language as the user's request.`,
            },
            {
              role: 'user',
              content: `Current markdown content:\n\`\`\`markdown\n${markdown}\n\`\`\`\n\nUser request: ${userMessage}`,
            },
          ],
          response_format: zodResponseFormat(LlmEditorAssistantResponseSchema, 'editor_assistant_response'),
        });
        /* eslint-disable max-len */

        // Message delta handler
        const messageDeltaHandler = async(delta: MessageDelta) => {
          const content = delta.content?.[0];

          // Process annotations
          if (content?.type === 'text' && content?.text?.annotations != null) {
            await replaceAnnotationWithPageLink(content, req.user.lang);
          }

          // Process text
          if (content?.type === 'text' && content.text?.value) {
            const chunk = content.text.value;

            // Process data with JSON processor
            streamProcessor.process(rawBuffer, chunk);

            rawBuffer += chunk;
          }
          else {
            sseHelper.writeData(delta);
          }
        };

        // Register event handlers
        stream.on('messageDelta', messageDeltaHandler);

        // Run error handler
        stream.on('event', (delta) => {
          if (delta.event === 'thread.run.failed') {
            const errorMessage = delta.data.last_error?.message;
            if (errorMessage == null) return;

            logger.error(errorMessage);
            sseHelper.writeError(errorMessage, getStreamErrorCode(errorMessage));
          }
        });

        // Completion handler
        stream.once('messageDone', () => {
          // Process and send final result
          streamProcessor.sendFinalResult(rawBuffer);

          // Clean up stream
          streamProcessor.destroy();
          stream.off('messageDelta', messageDeltaHandler);
          sseHelper.end();
        });

        // Error handler
        stream.once('error', (err) => {
          logger.error('Stream error:', err);

          // Clean up
          streamProcessor.destroy();
          stream.off('messageDelta', messageDeltaHandler);
          sseHelper.writeError('An error occurred while processing your request');
          sseHelper.end();
        });

        // Clean up on client disconnect
        req.on('close', () => {
          streamProcessor.destroy();

          if (stream) {
            stream.off('messageDelta', () => {});
            stream.off('event', () => {});
          }

          logger.debug('Connection closed by client');
        });
      }
      catch (err) {
        // Clean up and respond on error
        logger.error('Error in edit handler:', err);
        streamProcessor.destroy();
        return res.status(500).send(err.message);
      }
    },
  ];
};
