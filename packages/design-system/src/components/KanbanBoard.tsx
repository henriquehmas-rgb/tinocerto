import React from 'react';
import { KanbanColumn } from './KanbanColumn';

export interface KanbanBoardProps<T> {
  colunas: { chave: string; titulo: string }[];
  itens: Record<string, T[]>;
  renderItem: (item: T) => React.ReactNode;
  onMoverItem: (item: T, novaColuna: string) => void;
  labelMover?: (item: T) => string;
}

export function KanbanBoard<T extends { id: string | number; nome?: string }>({
  colunas,
  itens,
  renderItem,
  onMoverItem,
  labelMover,
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto">
      {colunas.map((coluna) => (
        <KanbanColumn
          key={coluna.chave}
          titulo={coluna.titulo}
          itens={itens[coluna.chave] ?? []}
          colunasDestino={colunas.filter((c) => c.chave !== coluna.chave)}
          renderItem={renderItem}
          labelMover={labelMover ?? ((item) => `Mover ${item.nome ?? 'item'}`)}
          onMoverItem={onMoverItem}
        />
      ))}
    </div>
  );
}
