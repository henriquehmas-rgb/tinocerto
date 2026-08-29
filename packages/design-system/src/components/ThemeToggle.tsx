import React, { useRef } from "react";
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
  const refsBotoes = useRef<(HTMLButtonElement | null)[]>([]);

  function moverFoco(indiceAtual: number, direcao: 1 | -1) {
    const total = OPCOES.length;
    const proximoIndice = (indiceAtual + direcao + total) % total;
    const proximaOpcao = OPCOES[proximoIndice];
    onChange(proximaOpcao.valor);
    refsBotoes.current[proximoIndice]?.focus();
  }

  function aoPressionarTecla(evento: React.KeyboardEvent<HTMLButtonElement>, indiceAtual: number) {
    switch (evento.key) {
      case "ArrowRight":
      case "ArrowDown":
        evento.preventDefault();
        moverFoco(indiceAtual, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        evento.preventDefault();
        moverFoco(indiceAtual, -1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex gap-0.5 rounded-full border border-border p-0.5"
    >
      {OPCOES.map(({ valor: opcao, rotulo, Icone }, indice) => {
        const ativo = opcao === valor;
        return (
          <button
            key={opcao}
            ref={(el) => {
              refsBotoes.current[indice] = el;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={rotulo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(opcao)}
            onKeyDown={(evento) => aoPressionarTecla(evento, indice)}
            className={`pr-focusable flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-[var(--pr-dur-micro)]${
              ativo ? "" : " hover:bg-[var(--pr-surface-sunken)]"
            }`}
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
