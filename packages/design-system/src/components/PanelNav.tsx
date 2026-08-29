import React from "react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle, type Tema } from "./ThemeToggle";

export interface PanelNavItem {
  href: string;
  label: string;
  icone: LucideIcon;
  contador?: number;
  ativo?: boolean;
}

export interface PanelNavGrupo {
  rotulo: string;
  itens: PanelNavItem[];
}

export interface PanelNavProps {
  nomeStaff: string;
  nomeTenant: string;
  grupos: PanelNavGrupo[];
  tema: Tema;
  onTemaChange: (tema: Tema) => void;
  onSair: () => void;
  /** Componente de link do consumidor (ex.: `Link` do Next). Padrão: `'a'`. */
  linkAs?: React.ElementType;
}

// Hoje as páginas passam o e-mail do staff em `nomeStaff` (a API não expõe
// nome próprio), então a regra precisa tolerar isso.
export function iniciaisDe(nome: string): string {
  const base = nome.includes("@") ? nome.slice(0, nome.indexOf("@")) : nome;
  const palavras = base.split(/[\s._-]+/).filter(Boolean);
  if (palavras.length === 0) return "";
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

export function PanelNav({
  nomeStaff,
  nomeTenant,
  grupos,
  tema,
  onTemaChange,
  onSair,
  linkAs: Link = "a",
}: PanelNavProps) {
  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-[216px] shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-14 items-center px-4 text-text">
        <Logo className="h-5 w-auto" />
      </div>

      <div className="flex flex-1 flex-col gap-4 px-2 py-2">
        {grupos.map((grupo) => (
          <div key={grupo.rotulo}>
            <p className="px-2 pb-1 font-num text-[11px] font-semibold uppercase tracking-[0.07em] text-text-secondary">
              {grupo.rotulo}
            </p>
            <ul className="flex list-none flex-col gap-0.5 p-0">
              {grupo.itens.map((item) => {
                const Icone = item.icone;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={item.ativo ? "page" : undefined}
                      className="pr-focusable flex h-[30px] items-center gap-2 rounded-[10px] px-2 font-ui text-[13px] no-underline"
                      style={
                        item.ativo
                          ? {
                              background: "var(--pr-selected)",
                              color: "var(--pr-text)",
                              boxShadow: "inset 2px 0 0 var(--pr-accent)",
                            }
                          : { color: "var(--pr-text-secondary)" }
                      }
                    >
                      <Icone size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.contador !== undefined && (
                        <span className="font-num text-[11px] tabular-nums text-text-secondary">
                          {item.contador}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-num text-[11px] font-semibold"
            style={{ background: "var(--pr-accent-soft)", color: "var(--pr-accent-text)" }}
          >
            {iniciaisDe(nomeStaff)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-ui text-[13px] font-medium text-text">{nomeStaff}</p>
            <p className="truncate font-ui text-[11px] text-text-secondary">{nomeTenant}</p>
          </div>
        </div>
        <ThemeToggle valor={tema} onChange={onTemaChange} />
        <button
          type="button"
          onClick={onSair}
          className="pr-focusable rounded-control border border-border px-3 py-1.5 text-left font-ui text-[13px] text-text"
        >
          Sair
        </button>
      </div>
    </nav>
  );
}
