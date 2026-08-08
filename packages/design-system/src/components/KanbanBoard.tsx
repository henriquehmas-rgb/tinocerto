import React from 'react';
import { KanbanColumn } from './KanbanColumn';

export interface KanbanBoardProps<T> {
  colunas: { chave: string; titulo: string }[];
  itens: Record<string, T[]>;
  renderItem: (item: T) => React.ReactNode;
  onMoverItem: (item: T, novaColuna: string) => void;
}

export function KanbanBoard<T extends { nome?: string }>({ colunas, itens, renderItem, onMoverItem }: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto">
      {colunas.map((coluna) => (
        <KanbanColumn
          key={coluna.chave}
          titulo={coluna.titulo}
          itens={itens[coluna.chave] ?? []}
          colunasDestino={colunas.filter((c) => c.chave !== coluna.chave)}
          renderItem={renderItem}
          labelMover={(item) => `Mover ${(item as any).nome ?? 'item'}`}
          onMoverItem={onMoverItem}
        />
      ))}
    </div>
  );
}
