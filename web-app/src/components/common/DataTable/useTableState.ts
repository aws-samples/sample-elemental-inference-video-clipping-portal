import { useState, useMemo, useCallback } from 'react';
import { TableColumn, PaginationConfig, SortingConfig, FilterConfig, SelectionConfig } from './types';

interface UseTableStateOptions<T> {
  data: T[];
  columns: TableColumn<T>[];
  pageSize?: number;
  defaultSortColumn?: TableColumn<T>;
  defaultSortDescending?: boolean;
  selectionType?: 'single' | 'multi';
  placeholder?: string | undefined;
}

interface UseTableStateReturn<T> {
  filteredData: T[];
  paginatedData: T[];
  pagination: PaginationConfig;
  sorting: SortingConfig<T>;
  filtering: FilterConfig;
  selection: SelectionConfig<T>;
  totalItems: number;
}

export function useTableState<T extends Record<string, any>>({
  data,
  columns,
  pageSize = 10,
  defaultSortColumn,
  defaultSortDescending = false,
  selectionType = 'multi',
                                                               placeholder
}: UseTableStateOptions<T>): UseTableStateReturn<T> {
  // Pagination state
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  
  // Sorting state
  const [sortingColumn, setSortingColumn] = useState<TableColumn<T> | undefined>(defaultSortColumn);
  const [sortingDescending, setSortingDescending] = useState(defaultSortDescending);
  
  // Filtering state
  const [filteringText, setFilteringText] = useState('');
  
  // Selection state
  const [selectedItems, setSelectedItems] = useState<T[]>([]);

  // Filter data based on search text
  const filteredData = useMemo(() => {
    if (!filteringText) return data;
    
    const searchText = filteringText.toLowerCase();
    return data.filter(item => {
      // Add logic to perform the search through item.children array.
      // This is a recursive function that will search through all nested children.
      const searchChildren = (children: T[]) => {
        return children.some(child => {
          return columns.some(column => {
            if (!column.filterable) return false;
            let value: any = child[column.key as keyof T];
            if (column.key === "tags") {
              value = [...value, child["customTags" as keyof T] ?? []];
            }
            if (Array.isArray(value)) {
              return value.some((v: any) => String(v).toLowerCase().includes(searchText));
            }
            return String(value).toLowerCase().includes(searchText);
          });
        });
      };
      if (item.children) {
        return searchChildren(item.children);
      }

      return columns.some(column => {
        if (!column.filterable) return false;
        let value: any = item[column.key as keyof T];
        if (column.key === "tags") {
          value = [...value, item["customTags" as keyof T] ?? []];
        }
        if (Array.isArray(value)) {
          return value.some((v: any) => String(v).toLowerCase().includes(searchText));
        }
        return String(value).toLowerCase().includes(searchText);
      });
    });
  }, [data, filteringText, columns]);

  // Sort filtered data
  const sortedData = useMemo(() => {
    if (!sortingColumn) return filteredData;
    
    return [...filteredData].sort((a, b) => {
      const aValue = a[sortingColumn.key as keyof T];
      const bValue = b[sortingColumn.key as keyof T];
      
      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      if (aValue > bValue) comparison = 1;
      
      return sortingDescending ? -comparison : comparison;
    });
  }, [filteredData, sortingColumn, sortingDescending]);

  // Paginate sorted data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPageIndex - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPageIndex, pageSize]);

  // Calculate total pages
  const pagesCount = Math.ceil(sortedData.length / pageSize);

  // Handle page change
  const handlePageChange = useCallback((pageIndex: number) => {
    setCurrentPageIndex(pageIndex);
  }, []);

  // Handle sorting change
  const handleSortingChange = useCallback((column: TableColumn<T>, descending: boolean) => {
    setSortingColumn(column);
    setSortingDescending(descending);
    setCurrentPageIndex(1); // Reset to first page when sorting changes
  }, []);

  // Handle filtering change
  const handleFilteringChange = useCallback((text: string) => {
    setFilteringText(text);
    setCurrentPageIndex(1); // Reset to first page when filtering changes
  }, []);

  // Handle selection change
  const handleSelectionChange = useCallback((items: T[]) => {
    setSelectedItems(items);
  }, []);

  return {
    filteredData: sortedData,
    paginatedData,
    pagination: {
      currentPageIndex,
      pagesCount,
      pageSize,
      onPageChange: handlePageChange,
    },
    sorting: {
      sortingColumn,
      sortingDescending,
      onSortingChange: handleSortingChange,
    },
    filtering: {
      filteringText,
      placeholder,
      onFilteringChange: handleFilteringChange,
    },
    selection: {
      selectedItems,
      onSelectionChange: handleSelectionChange,
      selectionType,
    },
    totalItems: sortedData.length,
  };
}