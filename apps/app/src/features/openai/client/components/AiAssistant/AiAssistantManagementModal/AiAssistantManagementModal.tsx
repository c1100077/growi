import React, {
  useCallback, useState, useEffect, type JSX,
} from 'react';

import {
  type IGrantedGroup, isPopulated,
} from '@growi/core';
import { useTranslation } from 'react-i18next';
import { Modal, TabContent, TabPane } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';
import type { UpsertAiAssistantData } from '~/features/openai/interfaces/ai-assistant';
import { AiAssistantAccessScope, AiAssistantShareScope } from '~/features/openai/interfaces/ai-assistant';
import type { IPagePathWithDescendantCount, IPageForItem } from '~/interfaces/page';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import { useSWRxPagePathsWithDescendantCount } from '~/stores/page';
import loggerFactory from '~/utils/logger';

import type { SelectedPage } from '../../../../interfaces/selected-page';
import { removeGlobPath } from '../../../../utils/remove-glob-path';
import { createAiAssistant, updateAiAssistant } from '../../../services/ai-assistant';
import {
  useSWRxAiAssistants,
  useAiAssistantSidebar,
  useAiAssistantManagementModal,
  AiAssistantManagementModalPageMode,
} from '../../../stores/ai-assistant';

import { AiAssistantManagementEditInstruction } from './AiAssistantManagementEditInstruction';
import { AiAssistantManagementEditPages } from './AiAssistantManagementEditPages';
import { AiAssistantManagementEditShare } from './AiAssistantManagementEditShare';
import { AiAssistantManagementHome } from './AiAssistantManagementHome';

import styles from './AiAssistantManagementModal.module.scss';

const moduleClass = styles['grw-ai-assistant-management'] ?? '';

const logger = loggerFactory('growi:openai:client:components:AiAssistantManagementModal');

// PopulatedGrantedGroup[] -> IGrantedGroup[]
const convertToGrantedGroups = (selectedGroups: PopulatedGrantedGroup[]): IGrantedGroup[] => {
  return selectedGroups.map(group => ({
    type: group.type,
    item: group.item._id,
  }));
};

// IGrantedGroup[] -> PopulatedGrantedGroup[]
const convertToPopulatedGrantedGroups = (selectedGroups: IGrantedGroup[]): PopulatedGrantedGroup[] => {
  const populatedGrantedGroups = selectedGroups.filter(group => isPopulated(group.item)) as PopulatedGrantedGroup[];
  return populatedGrantedGroups;
};

const convertToSelectedPages = (pagePathPatterns: string[], pagePathsWithDescendantCount: IPagePathWithDescendantCount[]): SelectedPage[] => {
  return pagePathPatterns.map((pagePathPattern) => {
    const isIncludeSubPage = pagePathPattern.endsWith('/*');
    const path = isIncludeSubPage ? pagePathPattern.slice(0, -2) : pagePathPattern;
    const page = pagePathsWithDescendantCount.find(page => page.path === path);
    return {
      page: page ?? { path },
      isIncludeSubPage,
    };
  });
};

const AiAssistantManagementModalSubstance = (): JSX.Element => {
  // Hooks
  const { t } = useTranslation();
  const { mutate: mutateAiAssistants } = useSWRxAiAssistants();
  const { data: aiAssistantManagementModalData, close: closeAiAssistantManagementModal } = useAiAssistantManagementModal();
  const { data: aiAssistantSidebarData, refreshAiAssistantData } = useAiAssistantSidebar();
  const { data: pagePathsWithDescendantCount } = useSWRxPagePathsWithDescendantCount(
    removeGlobPath(aiAssistantManagementModalData?.aiAssistantData?.pagePathPatterns) ?? null,
    undefined,
    true,
    true,
  );

  const aiAssistant = aiAssistantManagementModalData?.aiAssistantData;
  const shouldEdit = aiAssistant != null;
  const pageMode = aiAssistantManagementModalData?.pageMode ?? AiAssistantManagementModalPageMode.HOME;


  // States
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [selectedShareScope, setSelectedShareScope] = useState<AiAssistantShareScope>(AiAssistantShareScope.SAME_AS_ACCESS_SCOPE);
  const [selectedAccessScope, setSelectedAccessScope] = useState<AiAssistantAccessScope>(AiAssistantAccessScope.OWNER);
  const [selectedUserGroupsForAccessScope, setSelectedUserGroupsForAccessScope] = useState<PopulatedGrantedGroup[]>([]);
  const [selectedUserGroupsForShareScope, setSelectedUserGroupsForShareScope] = useState<PopulatedGrantedGroup[]>([]);
  const [selectedPages, setSelectedPages] = useState<SelectedPage[]>([]);
  const [instruction, setInstruction] = useState<string>(t('modal_ai_assistant.default_instruction'));


  // Effects
  useEffect(() => {
    if (shouldEdit) {
      setName(aiAssistant.name);
      setDescription(aiAssistant.description);
      setInstruction(aiAssistant.additionalInstruction);
      setSelectedShareScope(aiAssistant.shareScope);
      setSelectedAccessScope(aiAssistant.accessScope);
      setSelectedUserGroupsForShareScope(convertToPopulatedGrantedGroups(aiAssistant.grantedGroupsForShareScope ?? []));
      setSelectedUserGroupsForAccessScope(convertToPopulatedGrantedGroups(aiAssistant.grantedGroupsForAccessScope ?? []));
    }
  // eslint-disable-next-line max-len
  }, [aiAssistant?.accessScope, aiAssistant?.additionalInstruction, aiAssistant?.description, aiAssistant?.grantedGroupsForAccessScope, aiAssistant?.grantedGroupsForShareScope, aiAssistant?.name, aiAssistant?.pagePathPatterns, aiAssistant?.shareScope, shouldEdit]);

  useEffect(() => {
    if (shouldEdit && pagePathsWithDescendantCount != null) {
      setSelectedPages(convertToSelectedPages(aiAssistant.pagePathPatterns, pagePathsWithDescendantCount));
    }
  }, [aiAssistant?.pagePathPatterns, pagePathsWithDescendantCount, shouldEdit]);


  /*
  *  For AiAssistantManagementHome methods
  */
  const changeNameHandler = useCallback((value: string) => {
    setName(value);
  }, []);

  const changeDescriptionHandler = useCallback((value: string) => {
    setDescription(value);
  }, []);

  const upsertAiAssistantHandler = useCallback(async() => {
    try {
      const pagePathPatterns = selectedPages
        .map(selectedPage => (selectedPage.isIncludeSubPage ? `${selectedPage.page.path}/*` : selectedPage.page.path))
        .filter((path): path is string => path !== undefined && path !== null);

      const grantedGroupsForShareScope = selectedShareScope === AiAssistantShareScope.GROUPS
        ? convertToGrantedGroups(selectedUserGroupsForShareScope)
        : undefined;

      const grantedGroupsForAccessScope = selectedAccessScope === AiAssistantAccessScope.GROUPS
        ? convertToGrantedGroups(selectedUserGroupsForAccessScope)
        : undefined;

      const reqBody: UpsertAiAssistantData = {
        name,
        description,
        additionalInstruction: instruction,
        pagePathPatterns,
        shareScope: selectedShareScope,
        accessScope: selectedAccessScope,
        grantedGroupsForShareScope,
        grantedGroupsForAccessScope,
      };

      if (shouldEdit) {
        const updatedAiAssistant = await updateAiAssistant(aiAssistant._id, reqBody);
        if (aiAssistantSidebarData?.aiAssistantData?._id === updatedAiAssistant._id) {
          refreshAiAssistantData(updatedAiAssistant);
        }
      }
      else {
        await createAiAssistant(reqBody);
      }

      toastSuccess(shouldEdit ? t('modal_ai_assistant.toaster.update_success') : t('modal_ai_assistant.toaster.create_success'));
      mutateAiAssistants();
      closeAiAssistantManagementModal();
    }
    catch (err) {
      toastError(shouldEdit ? t('modal_ai_assistant.toaster.update_failed') : t('modal_ai_assistant.toaster.create_failed'));
      logger.error(err);
    }
  // eslint-disable-next-line max-len
  }, [t, selectedPages, selectedShareScope, selectedUserGroupsForShareScope, selectedAccessScope, selectedUserGroupsForAccessScope, name, description, instruction, shouldEdit, aiAssistant?._id, mutateAiAssistants, closeAiAssistantManagementModal]);


  /*
  *  For AiAssistantManagementEditShare methods
  */
  const selectShareScopeHandler = useCallback((shareScope: AiAssistantShareScope) => {
    setSelectedShareScope(shareScope);
  }, []);

  const selectAccessScopeHandler = useCallback((accessScope: AiAssistantAccessScope) => {
    setSelectedAccessScope(accessScope);
  }, []);

  const selectShareScopeUserGroups = useCallback((targetUserGroup: PopulatedGrantedGroup) => {
    const selectedUserGroupIds = selectedUserGroupsForShareScope.map(userGroup => userGroup.item._id);
    if (selectedUserGroupIds.includes(targetUserGroup.item._id)) {
      // if selected, remove it
      setSelectedUserGroupsForShareScope(selectedUserGroupsForShareScope.filter(userGroup => userGroup.item._id !== targetUserGroup.item._id));
    }
    else {
      // if not selected, add it
      setSelectedUserGroupsForShareScope([...selectedUserGroupsForShareScope, targetUserGroup]);
    }
  }, [selectedUserGroupsForShareScope]);

  const selectAccessScopeUserGroups = useCallback((targetUserGroup: PopulatedGrantedGroup) => {
    const selectedUserGroupIds = selectedUserGroupsForAccessScope.map(userGroup => userGroup.item._id);
    if (selectedUserGroupIds.includes(targetUserGroup.item._id)) {
      // if selected, remove it
      setSelectedUserGroupsForAccessScope(selectedUserGroupsForAccessScope.filter(userGroup => userGroup.item._id !== targetUserGroup.item._id));
    }
    else {
      // if not selected, add it
      setSelectedUserGroupsForAccessScope([...selectedUserGroupsForAccessScope, targetUserGroup]);
    }
  }, [selectedUserGroupsForAccessScope]);


  /*
  *  For AiAssistantManagementEditPages methods
  */
  const selectPageHandler = useCallback((page: IPageForItem, isIncludeSubPage: boolean) => {
    const selectedPageIds = selectedPages.map(selectedPage => selectedPage.page.path);
    if (page.path != null && !selectedPageIds.includes(page.path)) {
      setSelectedPages([...selectedPages, { page, isIncludeSubPage }]);
    }
  }, [selectedPages]);

  const removePageHandler = useCallback((pagePath: string) => {
    setSelectedPages(selectedPages.filter(selectedPage => selectedPage.page.path !== pagePath));
  }, [selectedPages]);


  /*
  *  For AiAssistantManagementEditInstruction methods
  */
  const changeInstructionHandler = useCallback((value: string) => {
    setInstruction(value);
  }, []);

  const resetInstructionHandler = useCallback(() => {
    setInstruction(t('modal_ai_assistant.default_instruction'));
  }, [t]);

  return (
    <>
      <TabContent activeTab={pageMode}>
        <TabPane tabId={AiAssistantManagementModalPageMode.HOME}>
          <AiAssistantManagementHome
            shouldEdit={shouldEdit}
            name={name}
            description={description}
            shareScope={selectedShareScope}
            accessScope={selectedAccessScope}
            instruction={instruction}
            selectedPages={selectedPages}
            selectedUserGroupsForShareScope={selectedUserGroupsForShareScope}
            selectedUserGroupsForAccessScope={selectedUserGroupsForAccessScope}
            onNameChange={changeNameHandler}
            onDescriptionChange={changeDescriptionHandler}
            onUpsertAiAssistant={upsertAiAssistantHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.SHARE}>
          <AiAssistantManagementEditShare
            selectedShareScope={selectedShareScope}
            selectedAccessScope={selectedAccessScope}
            selectedUserGroupsForShareScope={selectedUserGroupsForShareScope}
            selectedUserGroupsForAccessScope={selectedUserGroupsForAccessScope}
            onSelectShareScope={selectShareScopeHandler}
            onSelectAccessScope={selectAccessScopeHandler}
            onSelectAccessScopeUserGroups={selectAccessScopeUserGroups}
            onSelectShareScopeUserGroups={selectShareScopeUserGroups}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.PAGES}>
          <AiAssistantManagementEditPages
            selectedPages={selectedPages}
            onSelect={selectPageHandler}
            onRemove={removePageHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.INSTRUCTION}>
          <AiAssistantManagementEditInstruction
            instruction={instruction}
            onChange={changeInstructionHandler}
            onReset={resetInstructionHandler}
          />
        </TabPane>
      </TabContent>
    </>
  );
};


export const AiAssistantManagementModal = (): JSX.Element => {
  const { data: aiAssistantManagementModalData, close: closeAiAssistantManagementModal } = useAiAssistantManagementModal();

  const isOpened = aiAssistantManagementModalData?.isOpened ?? false;

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeAiAssistantManagementModal} className={moduleClass} scrollable>
      { isOpened && (
        <AiAssistantManagementModalSubstance />
      ) }
    </Modal>
  );
};
