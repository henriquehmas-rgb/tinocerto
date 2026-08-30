import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

export interface KanbanColumnProps<T> {
  chave: string;
  titulo: string;
  itens: T[];
  total: number;
  conversao?: number | null;
  colunasDestino: { chave: string; titulo: string }[];
  renderItem: (item: T, acao: React.ReactNode) => React.ReactNode;
  labelMover: (item: T) => string;
  onMoverItem: (item: T, novaColuna: string) => void;
  onSoltarItem?: (chaveDestino: string) => void;
  mensagemVazia?: string;
}

export function KanbanColumn<T extends { id: string | number }>({
  chave,
  titulo,
  itens,
  total,
  conversao,
  colunasDestino,
  renderItem,
  labelMover,
  onMoverItem,
  onSoltarItem,
  mensagemVazia = "Nenhum item nesta etapa",
}: KanbanColumnProps<T>) {
  return (
    <div
      data-testid={`coluna-${chave}`}
      className="flex min-w-[240px] flex-col gap-2"
      onDragOver={(evento) => {
        // Sem preventDefault o navegador não considera o alvo válido e
        // nunca dispara onDrop.
        if (onSoltarItem) evento.preventDefault();
      }}
      onDrop={() => onSoltarItem?.(chave)}
    >
      <div className="flex items-center gap-2 border-b-2 border-border pb-1">
        <h3 className="font-ui text-[12px] font-semibold text-text">{titulo}</h3>
        <span
          data-testid="contador"
          className="rounded-full px-1.5 font-num text-[11px] tabular-nums text-text-secondary"
          style={{ background: "var(--pr-surface-sunken)" }}
        >
          {total}
        </span>
        {conversao !== null && conversao !== undefined && (
          <span data-testid="conversao" className="ml-auto font-num text-[11px] tabular-nums text-text-secondary">
            {conversao}%
          </span>
        )}
      </div>

      {itens.length === 0 && <p className="font-ui text-sm text-text-secondary">{mensagemVazia}</p>}

      {itens.map((item) => {
        const acao = (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="pr-focusable rounded-control border border-border px-2 py-1 text-xs"
                aria-label={labelMover(item)}
              >
                Mover
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="rounded-panel border border-border bg-surface shadow-lg">
                {colunasDestino.map((coluna) => (
                  <DropdownMenu.Item
                    key={coluna.chave}
                    onSelect={() => onMoverItem(item, coluna.chave)}
                    className="cursor-pointer px-3 py-2 text-sm text-text outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent"
                  >
                    {coluna.titulo}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        );
        return <React.Fragment key={item.id}>{renderItem(item, acao)}</React.Fragment>;
      })}
    </div>
  );
}
