import React, {
  useCallback, useMemo, useRef, useState,
} from 'react';

import { useTranslation } from 'next-i18next';

import type { ISelectableAll, ISelectableAndIndeterminatable } from '~/client/interfaces/selectable-all';
import { useKeywordManager } from '~/client/services/search-operation';
import type { IFormattedSearchResult } from '~/interfaces/search';
import { useIsSearchServiceReachable, useShowPageLimitationL } from '~/stores/context';
import { type ISearchConditions, type ISearchConfigurations, useSWRxSearch } from '~/stores/search';

import { NotAvailableForGuest } from './NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from './NotAvailableForReadOnlyUser';
import PaginationWrapper from './PaginationWrapper';
import { OperateAllControl } from './SearchPage/OperateAllControl';
import SearchControl from './SearchPage/SearchControl';
import { type IReturnSelectedPageIds, SearchPageBase, usePageDeleteModalForBulkDeletion } from './SearchPage/SearchPageBase';


// TODO: replace with "customize:showPageLimitationS"
const INITIAL_PAGIONG_SIZE = 20;


/**
 * SearchResultListHead
 */

type SearchResultListHeadProps = {
  searchResult: IFormattedSearchResult,
  pagingSize: number,
  onPagingSizeChanged: (size: number) => void,
}

const SearchResultListHead = React.memo((props: SearchResultListHeadProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    searchResult, // pagingSize, onPagingSizeChanged,
  } = props;

  const { took, total } = searchResult.meta;

  if (total === 0) {
    return (
      <div className="d-flex justify-content-center h2 text-muted my-5">
        0 {t('search_result.page_number_unit')}
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center justify-content-between">
      <div className="text-nowrap">
        <span className="ms-3 fw-bold">{total} {t('search_result.hit_number_unit', 'hit')}</span>
        { took != null && (
          // blackout 70px rectangle in VRT
          <span data-vrt-blackout className="ms-3 text-muted d-inline-block" style={{ minWidth: '70px' }}>({took}ms)</span>
        ) }
      </div>
      {/* TODO: infinite scroll for search result */}
      {/* <div className="input-group flex-nowrap search-result-select-group ms-auto d-md-flex d-none">
        <div>
          <label className="form-label input-group-text text-muted" htmlFor="inputGroupSelect01">{t('search_result.number_of_list_to_display')}</label>
        </div>
        <select
          defaultValue={pagingSize}
          className="form-select"
          id="inputGroupSelect01"
          onChange={e => onPagingSizeChanged(Number(e.target.value))}
        >
          {[20, 50, 100, 200].map((limit) => {
            return <option key={limit} value={limit}>{limit} {t('search_result.page_number_unit')}</option>;
          })}
        </select>
      </div> */}
    </div>
  );
});

SearchResultListHead.displayName = 'SearchResultListHead';


export const SearchPage = (): JSX.Element => {
  const { t } = useTranslation();
  const { data: showPageLimitationL } = useShowPageLimitationL();

  const { data: keyword, pushState } = useKeywordManager();

  const [offset, setOffset] = useState<number>(0);
  const [limit, setLimit] = useState<number>(showPageLimitationL ?? INITIAL_PAGIONG_SIZE);
  const [configurationsByControl, setConfigurationsByControl] = useState<Partial<ISearchConfigurations>>({});
  const selectAllControlRef = useRef<ISelectableAndIndeterminatable|null>(null);
  const searchPageBaseRef = useRef<ISelectableAll & IReturnSelectedPageIds|null>(null);

  const { data: isSearchServiceReachable } = useIsSearchServiceReachable();

  const { data, conditions, mutate } = useSWRxSearch(keyword ?? '', null, {
    ...configurationsByControl,
    offset,
    limit,
  });

  const searchInvokedHandler = useCallback((newKeyword: string, newConfigurations: Partial<ISearchConfigurations>) => {
    setOffset(0);
    setConfigurationsByControl(newConfigurations);

    pushState(newKeyword);

    mutate();
  }, [keyword, mutate, pushState]);

  const selectAllCheckboxChangedHandler = useCallback((isChecked: boolean) => {
    const instance = searchPageBaseRef.current;

    if (instance == null) {
      return;
    }

    if (isChecked) {
      instance.selectAll();
    }
    else {
      instance.deselectAll();
    }
  }, []);

  const selectedPagesByCheckboxesChangedHandler = useCallback((selectedCount: number, totalCount: number) => {
    const instance = selectAllControlRef.current;

    if (instance == null) {
      return;
    }

    if (selectedCount === 0) {
      instance.deselect();
    }
    else if (selectedCount === totalCount) {
      instance.select();
    }
    else {
      instance.setIndeterminate();
    }
  }, []);

  const pagingSizeChangedHandler = useCallback((pagingSize: number) => {
    setOffset(0);
    setLimit(pagingSize);
    mutate();
  }, [mutate]);

  const pagingNumberChangedHandler = useCallback((activePage: number) => {
    setOffset((activePage - 1) * limit);
    mutate();
  }, [limit, mutate]);

  const initialSearchConditions: Partial<ISearchConditions> = useMemo(() => {
    return {
      keyword,
      limit: INITIAL_PAGIONG_SIZE,
    };
  }, [keyword]);

  // for bulk deletion
  const deleteAllButtonClickedHandler = usePageDeleteModalForBulkDeletion(data, searchPageBaseRef, () => mutate());

  const hitsCount = data?.meta.hitsCount;

  const allControl = useMemo(() => {
    const isDisabled = hitsCount === 0;

    return (
      <NotAvailableForGuest>
        <NotAvailableForReadOnlyUser>
          <OperateAllControl
            ref={selectAllControlRef}
            isCheckboxDisabled={isDisabled}
            onCheckboxChanged={selectAllCheckboxChangedHandler}
          >
            <button
              type="button"
              className="btn border-0 text-danger"
              disabled={isDisabled}
              onClick={deleteAllButtonClickedHandler}
            >
              {t('search_result.delete_all_selected_page')}
            </button>
          </OperateAllControl>
        </NotAvailableForReadOnlyUser>
      </NotAvailableForGuest>
    );
  }, [deleteAllButtonClickedHandler, hitsCount, selectAllCheckboxChangedHandler, t]);

  const searchControl = useMemo(() => {
    if (!isSearchServiceReachable) {
      return <></>;
    }
    return (
      <SearchControl
        isSearchServiceReachable={isSearchServiceReachable}
        isEnableSort
        isEnableFilter
        initialSearchConditions={initialSearchConditions}
        onSearchInvoked={searchInvokedHandler}
        allControl={allControl}
      />
    );
  }, [allControl, initialSearchConditions, isSearchServiceReachable, searchInvokedHandler]);

  const searchResultListHead = useMemo(() => {
    if (data == null) {
      return <></>;
    }
    return (
      <SearchResultListHead
        searchResult={data}
        pagingSize={limit}
        onPagingSizeChanged={pagingSizeChangedHandler}
      />
    );
  }, [data, limit, pagingSizeChangedHandler]);

  const searchPager = useMemo(() => {
    // when pager is not needed
    if (data == null || data.meta.hitsCount === data.meta.total) {
      return <></>;
    }

    const { total } = data.meta;
    const { offset, limit } = conditions;

    return (
      <PaginationWrapper
        activePage={Math.floor(offset / limit) + 1}
        totalItemsCount={total}
        pagingLimit={limit}
        changePage={pagingNumberChangedHandler}
      />
    );
  }, [conditions, data, pagingNumberChangedHandler]);

  return (
    <SearchPageBase
      ref={searchPageBaseRef}
      pages={data?.data}
      searchingKeyword={keyword}
      onSelectedPagesByCheckboxesChanged={selectedPagesByCheckboxesChangedHandler}
      // Components
      searchControl={searchControl}
      searchResultListHead={searchResultListHead}
      searchPager={searchPager}
    />
  );
};
