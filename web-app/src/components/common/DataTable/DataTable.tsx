import React, { useState } from "react";
import { Box, Pagination, Table, TextFilter } from "@cloudscape-design/components";
import { DataTableProps } from "./types";

export function DataTable<T extends Record<string, any>>({
    data,
    columns,
    loading = false,
    empty,
    pagination,
    sorting,
    filtering,
    variant = "container",
    stickyHeader = false,
    stripedRows = false,
    wrapLines = false,
    resizableColumns = false,
    trackBy,
    className,
    tableSelection,
    statusFilter,
    selectedItems,
    onSelectionChange,
}: DataTableProps<T>) {
    const [expandedItems, setExpandedItems] = useState<any[]>([]);
    const hasExpandableItems = data.some((item: any) => Boolean(item.children));
    // Convert our column definitions to Cloudscape format
    const cloudscapeColumns = columns.map((column) => ({
        id: String(column.key),
        header: column.header,
        sortingField: column.sortable ? String(column.key) : undefined,
        width: column.width,
        minWidth: column.minWidth,
        cell: (item: T) => {
            if (column.render) {
                return column.render(item, column);
            }
            return item[column.key as keyof T] || "";
        },
    }));

    // Handle sorting
    const sortingProps = sorting
        ? {
              sortingColumn: sorting.sortingColumn
                  ? {
                        sortingField: String(sorting.sortingColumn.key),
                    }
                  : undefined,
              sortingDescending: sorting.sortingDescending,
              onSortingChange: (event: any) => {
                  const column = columns.find(
                      (col) => String(col.key) === event.detail.sortingColumn?.sortingField,
                  );
                  if (column && sorting.onSortingChange) {
                      sorting.onSortingChange(column, event.detail.isDescending || false);
                  }
              },
          }
        : {};

    return (
        <div className={className}>
            <Table
                {...sortingProps}
                columnDefinitions={cloudscapeColumns}
                items={data}
                loading={loading}
                loadingText="Loading data..."
                empty={
                    empty || (
                        <Box textAlign="center" color="inherit">
                            <b>No data</b>
                            <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                                No data to display.
                            </Box>
                        </Box>
                    )
                }
                isItemDisabled={item =>
                    item.status === "review_in_progress" || item.status === "processing"
                }
                selectionType={tableSelection}
                selectedItems={selectedItems}
                onSelectionChange={(event: any) => {
                    onSelectionChange?.(event.detail.selectedItems);
                }}
                {...(hasExpandableItems ? {
                    expandableRows: {
                        getItemChildren: (item: any) => item.children,
                        isItemExpandable: (item: any) => Boolean(item.children),
                        expandedItems: expandedItems,
                        onExpandableItemToggle: ({ detail }: any) =>
                          setExpandedItems(prev => {
                            const next = new Set(
                              (prev ?? []).map((item: any) => item.id)
                            );
                            detail.expanded
                              ? next.add(detail.item.id)
                              : next.delete(detail.item.id);
                            return [...next].map(id => ({ id }));
                          })
                    }
                } : {})}
                filter={
                    filtering ? (
                        <div style={{ display: "flex", justifyContent: "flex-start", gap: 8 }}>
                            <div style={{ width: 400 }}>
                                <TextFilter
                                    filteringText={filtering.filteringText}
                                    filteringPlaceholder={filtering.placeholder}
                                    filteringAriaLabel="Filter items"
                                    onChange={({ detail }) =>
                                        filtering.onFilteringChange(detail.filteringText)
                                    }
                                />
                            </div>
                            {statusFilter}
                        </div>
                    ) : undefined
                }
                pagination={
                    pagination ? (
                        <Pagination
                            currentPageIndex={pagination.currentPageIndex}
                            pagesCount={pagination.pagesCount}
                            onChange={({ detail }) =>
                                pagination.onPageChange(detail.currentPageIndex)
                            }
                        />
                    ) : undefined
                }
                enableKeyboardNavigation
                variant={variant}
                stickyHeader={stickyHeader}
                stripedRows={stripedRows}
                wrapLines={wrapLines}
                resizableColumns={resizableColumns}
                trackBy="id"
                ariaLabels={{
                    selectionGroupLabel: "Items selection",
                    allItemsSelectionLabel: ({ selectedItems }) =>
                        `${selectedItems.length} ${selectedItems.length === 1 ? "item" : "items"} selected`,
                    itemSelectionLabel: ({ selectedItems }, item) => {
                        const isItemSelected =
                            selectedItems.filter((i) =>
                                trackBy ? trackBy(i) === trackBy(item) : i === item,
                            ).length > 0;
                        return `${item.name || item.id || "Item"} is ${isItemSelected ? "" : "not "}selected`;
                    },
                }}
            />
        </div>
    );
}
