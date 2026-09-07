import React from "react";

export interface EtapaBarraItem {
  etapa: string;
  rotulo: string;
  total: number;
  conversao?: number | null;
}

export interface EtapaBarraProps {
  itens: EtapaBarraItem[];
}

export function EtapaBarra({ itens }: EtapaBarraProps) {
  // Math.max com o literal 1 como primeiro argumento evita dividir por
  // zero quando itens está vazio (spread vazio) ou quando todo mundo tem
  // total 0 -- nos dois casos as barras ficam com largura 0%, não NaN%.
  const maior = Math.max(1, ...itens.map((item) => item.total));

  return (
    <div className="flex flex-col gap-2">
      {itens.map((item) => (
        <div key={item.etapa}>
          <div className="mb-1 flex items-center justify-between font-ui text-sm text-text">
            <span>{item.rotulo}</span>
            <span className="font-num tabular-nums text-text-secondary">
              {item.total}
              {item.conversao !== null && item.conversao !== undefined ? ` · ${item.conversao}%` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-control border border-border bg-surface">
            <div
              data-testid="etapa-barra-fill"
              className="h-full bg-accent"
              style={{ width: `${(item.total / maior) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
