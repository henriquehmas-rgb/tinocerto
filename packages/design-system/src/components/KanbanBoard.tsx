import React from "react";
import { KanbanColumn } from "./KanbanColumn";

export interface KanbanBoardColuna {
  chave: string;
  titulo: string;
  conversao?: number | null;
}

export interface KanbanBoardProps<T> {
  colunas: KanbanBoardColuna[];
  itens: Record<string, T[]>;
  renderItem: (item: T, acao: React.ReactNode) => React.ReactNode;
  onMoverItem: (item: T, novaColuna: string) => void;
  onSoltarItem?: (chaveDestino: string) => void;
  labelMover?: (item: T) => string;
  mensagemVazia?: string;
}

export function KanbanBoard<T extends { id: string | number; nome?: string }>({
  colunas,
  itens,
  renderItem,
  onMoverItem,
  onSoltarItem,
  labelMover,
  mensagemVazia,
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-4 overflow-x-auto">
      {colunas.map((coluna) => {
        const doColuna = itens[coluna.chave] ?? [];
        return (
          <KanbanColumn
            key={coluna.chave}
            chave={coluna.chave}
            titulo={coluna.titulo}
            itens={doColuna}
            total={doColuna.length}
            conversao={coluna.conversao}
            colunasDestino={colunas.filter((c) => c.chave !== coluna.chave)}
            renderItem={renderItem}
            labelMover={labelMover ?? ((item) => `Mover ${item.nome ?? "item"}`)}
            onMoverItem={onMoverItem}
            onSoltarItem={onSoltarItem}
            mensagemVazia={mensagemVazia}
          />
        );
      })}
    </div>
  );
}
