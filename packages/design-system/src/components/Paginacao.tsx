import React from "react";

export interface PaginacaoProps {
  paginaAtual: number;
  totalPaginas: number;
  totalItens: number;
  itensPorPagina: number;
  onPaginaChange: (pagina: number) => void;
}

export function Paginacao({
  paginaAtual,
  totalPaginas,
  totalItens,
  itensPorPagina,
  onPaginaChange,
}: PaginacaoProps) {
  const inicio = totalItens === 0 ? 0 : (paginaAtual - 1) * itensPorPagina + 1;
  const fim = totalItens === 0 ? 0 : Math.min(paginaAtual * itensPorPagina, totalItens);

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="font-num text-[13px] tabular-nums text-text-secondary">
        {inicio}–{fim} de {totalItens}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPaginaChange(paginaAtual - 1)}
          disabled={paginaAtual <= 1}
          className="pr-focusable rounded-control border border-border px-3 py-1.5 font-ui text-sm text-text disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onPaginaChange(paginaAtual + 1)}
          disabled={paginaAtual >= totalPaginas}
          className="pr-focusable rounded-control border border-border px-3 py-1.5 font-ui text-sm text-text disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
