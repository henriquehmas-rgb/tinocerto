import React from "react";
import { iniciaisDe } from "./PanelNav";

export interface CandidateCardChip {
  rotulo: string;
}

export interface CandidateCardProps {
  nome: string;
  /** `null` ou ausente significa "sem dado" -- nada de fit é renderizado. */
  scoreAderencia?: number | null;
  chips?: CandidateCardChip[];
  acao?: React.ReactNode;
  arrastavel?: boolean;
  onArrastarInicio?: () => void;
  /** Quando presente, o nome vira link para a candidatura (ex.: página de detalhe). */
  href?: string;
  /** Componente de link do consumidor (ex.: `Link` do Next). Padrão: `'a'`. */
  linkAs?: React.ElementType;
}

export function CandidateCard({
  nome,
  scoreAderencia,
  chips = [],
  acao,
  arrastavel = false,
  onArrastarInicio,
  href,
  linkAs: Link = "a",
}: CandidateCardProps) {
  const temFit = scoreAderencia !== null && scoreAderencia !== undefined;

  // O card raiz é `draggable`. Um <a href> nativo dentro dele também é
  // draggable por padrão, e o navegador prioriza o drag do link (arrastando a
  // URL) sobre o drag do card. `draggable={false}` no link devolve o drag pro
  // card, que é o que o funil precisa pra funcionar arrastando a partir do nome.
  const nomeElemento = href ? (
    <Link
      href={href}
      draggable={false}
      className="min-w-0 flex-1 truncate font-ui text-[13px] font-semibold text-text no-underline"
    >
      {nome}
    </Link>
  ) : (
    <span className="min-w-0 flex-1 truncate font-ui text-[13px] font-semibold text-text">{nome}</span>
  );

  return (
    <div
      data-testid="candidate-card"
      draggable={arrastavel || undefined}
      onDragStart={onArrastarInicio}
      className="flex w-[228px] flex-col gap-2 rounded-card border border-border bg-surface px-3 py-[11px]"
      style={{ boxShadow: "var(--pr-shadow-rest)" }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-num text-[10px] font-semibold"
          style={{ background: "var(--pr-accent-soft)", color: "var(--pr-accent-text)" }}
        >
          {iniciaisDe(nome)}
        </span>
        {nomeElemento}
        {temFit && (
          <span data-testid="fit" className="shrink-0 font-num text-[13px] tabular-nums text-text">
            {scoreAderencia}
          </span>
        )}
        {acao && <div className="shrink-0">{acao}</div>}
      </div>

      {temFit && (
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--pr-surface-sunken)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${scoreAderencia}%`, background: "var(--pr-accent)" }}
          />
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip, indice) => (
            <span
              key={`${chip.rotulo}-${indice}`}
              data-testid="chip"
              className="rounded-full px-2 py-0.5 font-ui text-[11px] text-text-secondary"
              style={{ background: "var(--pr-surface-sunken)" }}
            >
              {chip.rotulo}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
