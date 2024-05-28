import type { ChangeEvent } from 'react';
import { useState, useCallback } from 'react';

import nodePath from 'path';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { pathUtils } from '@growi/core/dist/utils';
import { isMovablePage } from '@growi/core/dist/utils/page-path-utils';
import { useTranslation } from 'next-i18next';

import type { InputValidationResult } from '~/client/util/use-input-validator';
import { ValidationTarget, useInputValidator } from '~/client/util/use-input-validator';

import { CopyDropdown } from '../Common/CopyDropdown';
import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '../Common/SubmittableInput';
import { usePagePathRenameHandler } from '../PageEditor/page-path-rename-utils';


import styles from './PageTitleHeader.module.scss';

const moduleClass = styles['page-title-header'] ?? '';
const borderColorClass = styles['page-title-header-border-color'] ?? '';

type Props = {
  currentPage: IPagePopulatedToShowRevision,
  className?: string,
  maxWidth?: number,
  onMoveTerminated?: () => void,
};

export const PageTitleHeader = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { currentPage, maxWidth, onMoveTerminated } = props;

  const currentPagePath = currentPage.path;

  const isMovable = isMovablePage(currentPagePath);

  const dPagePath = new DevidedPagePath(currentPage.path, true);
  const pageTitle = dPagePath.latter;

  const [isRenameInputShown, setRenameInputShown] = useState(false);
  const [editedPagePath, setEditedPagePath] = useState(currentPagePath);
  const [validationResult, setValidationResult] = useState<InputValidationResult>();

  const pagePathRenameHandler = usePagePathRenameHandler(currentPage);
  const inputValidator = useInputValidator(ValidationTarget.PAGE);

  const editedPageTitle = nodePath.basename(editedPagePath);

  // TODO: https://redmine.weseek.co.jp/issues/142729
  // https://regex101.com/r/Wg2Hh6/1
  const untitledPageRegex = /^Untitled-\d+$/;

  const isNewlyCreatedPage = (currentPage.wip && currentPage.latestRevision == null && untitledPageRegex.test(editedPageTitle)) ?? false;


  const changeHandler = useCallback(async(e: ChangeEvent<HTMLInputElement>) => {
    const newPageTitle = pathUtils.removeHeadingSlash(e.target.value);
    const parentPagePath = pathUtils.addTrailingSlash(nodePath.dirname(currentPage.path));
    const newPagePath = nodePath.resolve(parentPagePath, newPageTitle);

    setEditedPagePath(newPagePath);

    // validation
    const validationResult = inputValidator(e.target.value);
    setValidationResult(validationResult ?? undefined);
  }, [currentPage.path, inputValidator]);

  const rename = useCallback(() => {
    pagePathRenameHandler(editedPagePath,
      () => {
        setRenameInputShown(false);
        setValidationResult(undefined);
        onMoveTerminated?.();
      },
      () => {
        setRenameInputShown(true);
      });
  }, [editedPagePath, onMoveTerminated, pagePathRenameHandler]);

  const cancel = useCallback(() => {
    setEditedPagePath(currentPagePath);
    setValidationResult(undefined);
    setRenameInputShown(false);
  }, [currentPagePath]);

  const onClickPageTitle = useCallback(() => {
    if (!isMovable) {
      return;
    }

    setEditedPagePath(currentPagePath);
    setRenameInputShown(true);
  }, [currentPagePath, isMovable]);

  // TODO: auto focus when create new page
  // https://redmine.weseek.co.jp/issues/136128
  // useEffect(() => {
  //   if (isNewlyCreatedPage) {
  //     setRenameInputShown(true);
  //   }
  // }, [currentPage._id, isNewlyCreatedPage]);

  const isInvalid = validationResult != null;

  const inputMaxWidth = maxWidth != null
    ? getAdjustedMaxWidthForAutosizeInput(maxWidth, 'md', validationResult != null ? false : undefined) - 16
    : undefined;

  return (
    <div className={`d-flex ${moduleClass} ${props.className ?? ''} position-relative`}>
      <div className="page-title-header-input me-1 d-inline-block">
        { isRenameInputShown && (
          <div className="position-relative">
            <div className="position-absolute w-100">
              <AutosizeSubmittableInput
                value={isNewlyCreatedPage ? '' : editedPageTitle}
                inputClassName={`form-control fs-4 ${isInvalid ? 'is-invalid' : ''}`}
                inputStyle={{ maxWidth: inputMaxWidth }}
                placeholder={t('Input page name')}
                onChange={changeHandler}
                onSubmit={rename}
                onCancel={cancel}
                autoFocus
              />
            </div>
          </div>
        ) }
        <h1
          className={`mb-0 mb-sm-1 px-2 fs-4
            ${isRenameInputShown ? 'invisible' : ''} text-truncate
            ${isMovable ? 'border border-2 rounded-2' : ''} ${borderColorClass}
          `}
          onClick={onClickPageTitle}
        >
          {pageTitle}
        </h1>
      </div>

      <div className={`${isRenameInputShown ? 'invisible' : ''} d-flex align-items-center`}>
        { currentPage.wip && (
          <span className="badge rounded-pill text-bg-secondary ms-2">WIP</span>
        )}

        <CopyDropdown
          pageId={currentPage._id}
          pagePath={currentPage.path}
          dropdownToggleId={`copydropdown-${currentPage._id}`}
          dropdownToggleClassName="p-1"
        >
          <span className="material-symbols-outlined fs-6">content_paste</span>
        </CopyDropdown>
      </div>
    </div>
  );
};
