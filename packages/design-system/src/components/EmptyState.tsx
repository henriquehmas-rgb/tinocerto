import React from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}

export function EmptyState({ icone: Icone, titulo, descricao, acao }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Icone
        size={26}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: "var(--pr-slate-30)" }}
      />
      <p className="font-ui text-[13px] font-semibold text-text">{titulo}</p>
      <p className="max-w-[46ch] font-ui text-sm text-text-secondary">{descricao}</p>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}
