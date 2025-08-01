import type { Readable } from 'stream';

import type { GetObjectCommandInput, HeadObjectCommandInput } from '@aws-sdk/client-s3';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsCommand,
  ObjectCannedACL,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { NonBlankString } from '@growi/core/dist/interfaces';
import { toNonBlankStringOrUndefined } from '@growi/core/dist/interfaces';
import urljoin from 'url-join';

import type Crowi from '~/server/crowi';
import {
  AttachmentType, FilePathOnStoragePrefix, ResponseMode, type RespondOptions,
} from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../../config-manager';
import {
  AbstractFileUploader, type TemporaryUrl, type SaveFileParam,
} from '../file-uploader';
import { ContentHeaders } from '../utils';

import { AwsMultipartUploader } from './multipart-uploader';


const logger = loggerFactory('growi:service:fileUploaderAws');

/**
 * File metadata in storage
 * TODO: mv this to "./uploader"
 */
interface FileMeta {
  name: string;
  size: number;
}

const isFileExists = async(s3: S3Client, params: HeadObjectCommandInput) => {
  try {
    await s3.send(new HeadObjectCommand(params));
  }
  catch (err) {
    if (err != null && err.code === 'NotFound') {
      return false;
    }
    throw err;
  }
  return true;
};

const ObjectCannedACLs = [
  ObjectCannedACL.authenticated_read,
  ObjectCannedACL.aws_exec_read,
  ObjectCannedACL.bucket_owner_full_control,
  ObjectCannedACL.bucket_owner_read,
  ObjectCannedACL.private,
  ObjectCannedACL.public_read,
  ObjectCannedACL.public_read_write,
];
const isValidObjectCannedACL = (acl: string | undefined): acl is ObjectCannedACL => {
  return ObjectCannedACLs.includes(acl as ObjectCannedACL);
};
/**
 * @see: https://dev.growi.org/5d091f611fe336003eec5bfd
 * @returns ObjectCannedACL
 */
const getS3PutObjectCannedAcl = (): ObjectCannedACL | undefined => {
  const s3ObjectCannedACL = configManager.getConfig('aws:s3ObjectCannedACL');
  if (isValidObjectCannedACL(s3ObjectCannedACL)) {
    return s3ObjectCannedACL;
  }
  return undefined;
};

const getS3Bucket = (): NonBlankString | undefined => {
  return toNonBlankStringOrUndefined(configManager.getConfig('aws:s3Bucket')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
};

const S3Factory = (): S3Client => {
  const accessKeyId = configManager.getConfig('aws:s3AccessKeyId');
  const secretAccessKey = configManager.getConfig('aws:s3SecretAccessKey');
  const s3Region = toNonBlankStringOrUndefined(configManager.getConfig('aws:s3Region')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
  const s3CustomEndpoint = toNonBlankStringOrUndefined(configManager.getConfig('aws:s3CustomEndpoint'));

  return new S3Client({
    credentials: accessKeyId != null && secretAccessKey != null
      ? {
        accessKeyId,
        secretAccessKey,
      }
      : undefined,
    region: s3Region,
    endpoint: s3CustomEndpoint,
    forcePathStyle: s3CustomEndpoint != null, // s3ForcePathStyle renamed to forcePathStyle in v3
  });
};

const getFilePathOnStorage = (attachment: IAttachmentDocument) => {
  if (attachment.filePath != null) { // DEPRECATED: remains for backward compatibility for v3.3.x or below
    return attachment.filePath;
  }

  let dirName: string;
  if (attachment.attachmentType === AttachmentType.PAGE_BULK_EXPORT) {
    dirName = FilePathOnStoragePrefix.pageBulkExport;
  }
  else if (attachment.page != null) {
    dirName = FilePathOnStoragePrefix.attachment;
  }
  else {
    dirName = FilePathOnStoragePrefix.user;
  }
  const filePath = urljoin(dirName, attachment.fileName);

  return filePath;
};

// TODO: rewrite this module to be a type-safe implementation
class AwsFileUploader extends AbstractFileUploader {

  /**
   * @inheritdoc
   */
  override isValidUploadSettings(): boolean {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override listFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override saveFile(param: SaveFileParam) {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override deleteFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override determineResponseMode() {
    return configManager.getConfig('aws:referenceFileWithRelayMode')
      ? ResponseMode.RELAY
      : ResponseMode.REDIRECT;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }

    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const s3 = S3Factory();

    const filePath = getFilePathOnStorage(attachment);
    const contentHeaders = new ContentHeaders(attachment);

    await s3.send(new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: filePath,
      Body: readable,
      ACL: getS3PutObjectCannedAcl(),
      // put type and the file name for reference information when uploading
      ContentType: contentHeaders.contentType?.value.toString(),
      ContentDisposition: contentHeaders.contentDisposition?.value.toString(),
    }));
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error('AwsFileUploader does not support ResponseMode.DELEGATE.');
  }

  /**
   * @inheritdoc
   */
  override async findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream> {
    if (!this.getIsReadable()) {
      throw new Error('AWS is not configured.');
    }

    const s3 = S3Factory();
    const filePath = getFilePathOnStorage(attachment);

    const params = {
      Bucket: getS3Bucket(),
      Key: filePath,
    };

    // check file exists
    const isExists = await isFileExists(s3, params);
    if (!isExists) {
      throw new Error(`Any object that relate to the Attachment (${filePath}) does not exist in AWS S3`);
    }

    try {
      const body = (await s3.send(new GetObjectCommand(params))).Body;

      if (body == null) {
        throw new Error(`S3 returned null for the Attachment (${filePath})`);
      }

      // eslint-disable-next-line no-nested-ternary
      return 'stream' in body
        ? body.stream() as unknown as NodeJS.ReadableStream // get stream from Blob and cast force
        : body as unknown as NodeJS.ReadableStream; // cast force
    }
    catch (err) {
      logger.error(err);
      throw new Error(`Coudn't get file from AWS for the Attachment (${attachment._id.toString()})`);
    }
  }

  /**
   * @inheritDoc
   */
  override async generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl> {
    if (!this.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }

    const s3 = S3Factory();
    const filePath = getFilePathOnStorage(attachment);
    const lifetimeSecForTemporaryUrl = configManager.getConfig('aws:lifetimeSecForTemporaryUrl');

    // issue signed url (default: expires 120 seconds)
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getSignedUrl-property
    const isDownload = opts?.download ?? false;
    const contentHeaders = new ContentHeaders(attachment, { inline: !isDownload });
    const params: GetObjectCommandInput = {
      Bucket: getS3Bucket(),
      Key: filePath,
      ResponseContentType: contentHeaders.contentType?.value.toString(),
      ResponseContentDisposition: contentHeaders.contentDisposition?.value.toString(),
    };
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand(params), {
      expiresIn: lifetimeSecForTemporaryUrl,
    });

    return {
      url: signedUrl,
      lifetimeSec: lifetimeSecForTemporaryUrl,
    };

  }

  override createMultipartUploader(uploadKey: string, maxPartSize: number) {
    const s3 = S3Factory();
    return new AwsMultipartUploader(s3, getS3Bucket(), uploadKey, maxPartSize);
  }

  override async abortPreviousMultipartUpload(uploadKey: string, uploadId: string) {
    try {
      await S3Factory().send(new AbortMultipartUploadCommand({
        Bucket: getS3Bucket(),
        Key: uploadKey,
        UploadId: uploadId,
      }));
    }
    catch (e) {
      // allow duplicate abort requests to ensure abortion
      if (e.response?.status !== 404) {
        throw e;
      }
    }
  }

}

module.exports = (crowi: Crowi) => {
  const lib = new AwsFileUploader(crowi);

  lib.isValidUploadSettings = function() {
    return configManager.getConfig('aws:s3AccessKeyId') != null
      && configManager.getConfig('aws:s3SecretAccessKey') != null
      && (
        configManager.getConfig('aws:s3Region') != null
          || configManager.getConfig('aws:s3CustomEndpoint') != null
      )
      && configManager.getConfig('aws:s3Bucket') != null;
  };

  (lib as any).deleteFile = async function(attachment) {
    const filePath = getFilePathOnStorage(attachment);
    return (lib as any).deleteFileByFilePath(filePath);
  };

  (lib as any).deleteFiles = async function(attachments) {
    if (!lib.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }
    const s3 = S3Factory();

    const filePaths = attachments.map((attachment) => {
      return { Key: getFilePathOnStorage(attachment) };
    });

    const totalParams = {
      Bucket: getS3Bucket(),
      Delete: { Objects: filePaths },
    };
    return s3.send(new DeleteObjectsCommand(totalParams));
  };

  (lib as any).deleteFileByFilePath = async function(filePath) {
    if (!lib.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }
    const s3 = S3Factory();

    const params = {
      Bucket: getS3Bucket(),
      Key: filePath,
    };

    // check file exists
    const isExists = await isFileExists(s3, params);
    if (!isExists) {
      logger.warn(`Any object that relate to the Attachment (${filePath}) does not exist in AWS S3`);
      return;
    }

    return s3.send(new DeleteObjectCommand(params));
  };

  lib.saveFile = async function({ filePath, contentType, data }) {
    const s3 = S3Factory();

    return s3.send(new PutObjectCommand({
      Bucket: getS3Bucket(),
      ContentType: contentType,
      Key: filePath,
      Body: data,
      ACL: getS3PutObjectCannedAcl(),
    }));
  };

  (lib as any).checkLimit = async function(uploadFileSize) {
    const maxFileSize = configManager.getConfig('app:maxFileSize');
    const totalLimit = configManager.getConfig('app:fileUploadTotalLimit');
    return lib.doCheckLimit(uploadFileSize, maxFileSize, totalLimit);
  };

  /**
   * List files in storage
   */
  (lib as any).listFiles = async function() {
    if (!lib.getIsReadable()) {
      throw new Error('AWS is not configured.');
    }

    const files: FileMeta[] = [];
    const s3 = S3Factory();
    const params = {
      Bucket: getS3Bucket(),
    };
    let shouldContinue = true;
    let nextMarker: string | undefined;

    // handle pagination
    while (shouldContinue) {
      // eslint-disable-next-line no-await-in-loop
      const { Contents = [], IsTruncated, NextMarker } = await s3.send(new ListObjectsCommand({
        ...params,
        Marker: nextMarker,
      }));
      files.push(...(
        Contents.map(({ Key, Size }) => ({
          name: Key as string,
          size: Size as number,
        }))
      ));

      if (!IsTruncated) {
        shouldContinue = false;
        nextMarker = undefined;
      }
      else {
        nextMarker = NextMarker;
      }
    }

    return files;
  };

  return lib;
};
