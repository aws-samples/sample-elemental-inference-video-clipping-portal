import { ReactNode } from "react";
import { TableProps } from "@cloudscape-design/components/table";

export interface TableColumn<T> {
    key: keyof T | string;
    header: string;
    sortable?: boolean;
    filterable?: boolean;
    width?: number | string;
    minWidth?: number | string;
    render?: (item: T, column: TableColumn<T>) => ReactNode;
}

export interface PaginationConfig {
    currentPageIndex: number;
    pagesCount: number;
    pageSize: number;
    onPageChange: (pageIndex: number) => void;
}

export interface SortingConfig<T> {
    sortingColumn?: TableColumn<T>;
    sortingDescending?: boolean;
    onSortingChange: (column: TableColumn<T>, descending: boolean) => void;
}

export interface FilterConfig {
    filteringText: string;
    placeholder?: string;
    onFilteringChange: (text: string) => void;
}

export interface SelectionConfig<T> {
    selectedItems: T[];
    onSelectionChange: (items: T[]) => void;
    selectionType?: "single" | "multi";
}

export interface DataTableProps<T> {
    data: T[];
    columns: TableColumn<T>[];
    loading?: boolean;
    empty?: ReactNode;
    pagination?: PaginationConfig;
    sorting?: SortingConfig<T>;
    filtering?: FilterConfig;
    selection?: SelectionConfig<T>;
    variant?: TableProps.Variant;
    stickyHeader?: boolean;
    stripedRows?: boolean;
    wrapLines?: boolean;
    resizableColumns?: boolean;
    trackBy?: (item: T) => string;
    ariaLabel?: string;
    className?: string;
    tableSelection?: TableProps.SelectionType;
    statusFilter?: ReactNode;
    selectedItems: T[];
    onSelectionChange?: (selectedItems: T[]) => void;
}
