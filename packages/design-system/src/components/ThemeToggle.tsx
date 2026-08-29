import React from "react";
import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react";

export type Tema = "light" | "dark" | "auto";

export interface ThemeToggleProps {
  valor: Tema;
  onChange: (valor: Tema) => void;
}

const OPCOES: { valor: Tema; rotulo: string; Icone: LucideIcon }[] = [
  { valor: "light", rotulo: "Tema claro", Icone: Sun },
  { valor: "dark", rotulo: "Tema escuro", Icone: Moon },
  { valor: "auto", rotulo: "Tema automático", Icone: Monitor },
];

export function ThemeToggle({ valor, onChange }: ThemeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex gap-0.5 rounded-full border border-border p-0.5"
    >
      {OPCOES.map(({ valor: opcao, rotulo, Icone }) => {
        const ativo = opcao === valor;
        return (
          <button
            key={opcao}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={rotulo}
            onClick={() => onChange(opcao)}
            className="pr-focusable flex h-7 w-7 items-center justify-center rounded-full"
            style={
              ativo
                ? { background: "var(--pr-selected)", color: "var(--pr-accent-text)" }
                : { color: "var(--pr-text-secondary)" }
            }
          >
            <Icone size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
