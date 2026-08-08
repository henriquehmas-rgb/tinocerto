import React from 'react';

export interface TableColumn<T> {
  header: string;
  render: (row: T) => React.ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
}

export function Table<T>({ columns, rows }: TableProps<T>) {
  if (rows.length === 0) {
    return <p className="font-ui text-sm text-text-secondary p-4">Nenhum item encontrado</p>;
  }
  return (
    <table className="w-full font-ui text-sm">
      <thead>
        <tr className="border-b border-border">
          {columns.map((column) => (
            <th key={column.header} className="text-left px-3 py-2 text-text-secondary font-medium">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-border">
            {columns.map((column) => (
              <td key={column.header} className="px-3 py-2 text-text">
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
