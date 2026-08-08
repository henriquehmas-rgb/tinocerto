import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Card } from './Card';

export interface KanbanColumnProps<T> {
  titulo: string;
  itens: T[];
  colunasDestino: { chave: string; titulo: string }[];
  renderItem: (item: T) => React.ReactNode;
  labelMover: (item: T) => string;
  onMoverItem: (item: T, novaColuna: string) => void;
}

export function KanbanColumn<T>({ titulo, itens, colunasDestino, renderItem, labelMover, onMoverItem }: KanbanColumnProps<T>) {
  return (
    <div className="flex flex-col gap-2 min-w-[240px]">
      <h3 className="font-ui text-sm font-medium text-text-secondary">{titulo}</h3>
      {itens.map((item, index) => (
        <Card key={index}>
          <div className="flex items-center justify-between gap-2">
            <div>{renderItem(item)}</div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="rounded-control px-2 py-1 text-xs border border-border pr-focusable" aria-label={labelMover(item)}>
                  Mover
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="rounded-panel border border-border bg-surface shadow-lg">
                  {colunasDestino.map((coluna) => (
                    <DropdownMenu.Item
                      key={coluna.chave}
                      onSelect={() => onMoverItem(item, coluna.chave)}
                      className="px-3 py-2 text-sm text-text cursor-pointer data-[highlighted]:bg-accent data-[highlighted]:text-on-accent outline-none"
                    >
                      {coluna.titulo}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </Card>
      ))}
    </div>
  );
}
