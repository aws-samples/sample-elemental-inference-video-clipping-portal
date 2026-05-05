# DataTable Component

A reusable, feature-rich data table component built with AWS Cloudscape Design System. Provides sorting, filtering, pagination, and selection capabilities out of the box.

## Features

- **Sorting**: Click column headers to sort data
- **Filtering**: Real-time text-based filtering
- **Pagination**: Navigate through large datasets
- **Selection**: Single or multi-select with checkboxes
- **Custom Renderers**: Flexible column rendering with custom components
- **Loading States**: Built-in loading and empty state handling
- **Responsive**: Works across different screen sizes
- **Accessible**: Full ARIA support and keyboard navigation

## Basic Usage

```tsx
import { DataTable, TableColumn } from './components/common/DataTable';

const columns: TableColumn<MyDataType>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    filterable: true,
  },
  {
    key: 'status',
    header: 'Status',
    render: (item) => <Badge>{item.status}</Badge>,
  },
];

function MyComponent() {
  return (
    <DataTable
      data={myData}
      columns={columns}
      ariaLabel="My data table"
    />
  );
}
```

## Advanced Usage with State Management

```tsx
import { DataTable, useTableState, TableColumn } from './components/common/DataTable';

function AdvancedTable() {
  const tableState = useTableState({
    data: myData,
    columns: myColumns,
    pageSize: 20,
    defaultSortColumn: myColumns[0],
    selectionType: 'multi',
  });

  return (
    <DataTable
      data={tableState.paginatedData}
      columns={myColumns}
      pagination={tableState.pagination}
      sorting={tableState.sorting}
      filtering={tableState.filtering}
      selection={tableState.selection}
      trackBy={(item) => item.id}
    />
  );
}
```

## Column Configuration

### TableColumn Interface

```tsx
interface TableColumn<T> {
  key: keyof T | string;           // Data property key
  header: string;                  // Column header text
  sortable?: boolean;              // Enable sorting
  filterable?: boolean;            // Include in text filtering
  width?: number | string;         // Column width
  minWidth?: number | string;      // Minimum column width
  render?: (item: T, column: TableColumn<T>) => ReactNode; // Custom renderer
}
```

### Custom Renderers

The component includes several built-in renderers:

```tsx
import {
  renderEventStatus,
  renderClipStatus,
  renderDateTime,
  renderDuration,
  renderActions,
  renderBoolean,
  renderAge,
} from './components/common/DataTable/columnRenderers';

const columns: TableColumn<Event>[] = [
  {
    key: 'status',
    header: 'Status',
    render: (item) => renderEventStatus(item.status),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (item) => renderDateTime(item.createdAt),
  },
  {
    key: 'actions',
    header: 'Actions',
    render: (item) => renderActions([
      { text: 'Edit', onClick: () => editItem(item.id) },
      { text: 'Delete', onClick: () => deleteItem(item.id), variant: 'primary' },
    ]),
  },
];
```

## Props Reference

### DataTable Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | Required | Array of data items |
| `columns` | `TableColumn<T>[]` | Required | Column definitions |
| `loading` | `boolean` | `false` | Show loading state |
| `empty` | `ReactNode` | Default empty state | Custom empty state content |
| `pagination` | `PaginationConfig` | - | Pagination configuration |
| `sorting` | `SortingConfig<T>` | - | Sorting configuration |
| `filtering` | `FilterConfig` | - | Filtering configuration |
| `selection` | `SelectionConfig<T>` | - | Selection configuration |
| `variant` | `'container' \| 'embedded'` | `'container'` | Table variant |
| `stickyHeader` | `boolean` | `false` | Sticky header on scroll |
| `stripedRows` | `boolean` | `false` | Alternating row colors |
| `wrapLines` | `boolean` | `false` | Wrap long text in cells |
| `resizableColumns` | `boolean` | `false` | Allow column resizing |
| `trackBy` | `(item: T) => string` | - | Unique identifier function |
| `ariaLabel` | `string` | `'Data table'` | Accessibility label |

### useTableState Hook

The `useTableState` hook provides complete state management for the table:

```tsx
const tableState = useTableState({
  data: myData,                    // Required: source data
  columns: myColumns,              // Required: column definitions
  pageSize: 10,                    // Items per page
  defaultSortColumn: myColumns[0], // Initial sort column
  defaultSortDescending: false,    // Initial sort direction
  selectionType: 'multi',          // 'single' | 'multi'
});
```

Returns:
- `filteredData`: Data after filtering
- `paginatedData`: Data for current page
- `pagination`: Pagination controls
- `sorting`: Sorting controls
- `filtering`: Filter controls
- `selection`: Selection controls
- `totalItems`: Total filtered items count

## Examples

See `DataTableExample.tsx` for a complete working example with events data.

## Testing

The component includes comprehensive tests covering:
- Basic rendering and data display
- Loading and empty states
- Custom column renderers
- Pagination functionality
- Sorting behavior
- Filtering capabilities
- Selection handling
- State management hook

Run tests with:
```bash
npm test -- DataTable
```