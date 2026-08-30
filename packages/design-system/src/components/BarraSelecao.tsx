import React from "react";

export interface BarraSelecaoProps {
  quantidade: number;
  onMoverEtapa: () => void;
  onLimparSelecao: () => void;
}

export function BarraSelecao({ quantidade, onMoverEtapa, onLimparSelecao }: BarraSelecaoProps) {
  const rotulo = quantidade === 1 ? "1 selecionado" : `${quantidade} selecionados`;

  return (
    <div
      className="pr-glass flex h-10 items-center gap-4 rounded-control border border-border px-4 font-ui text-sm text-text"
    >
      <span className="font-semibold">{rotulo}</span>
      <button
        type="button"
        onClick={onMoverEtapa}
        className="pr-focusable rounded-control px-3 py-1.5 font-ui text-sm font-semibold"
        style={{ background: "var(--pr-accent)", color: "var(--pr-on-accent)" }}
      >
        Mover etapa
      </button>
      <button
        type="button"
        onClick={onLimparSelecao}
        className="pr-focusable rounded-control border border-border px-3 py-1.5 font-ui text-sm"
      >
        Limpar seleção
      </button>
      <span className="ml-auto font-ui text-xs text-text-secondary">
        shift+clique para selecionar intervalo
      </span>
    </div>
  );
}
