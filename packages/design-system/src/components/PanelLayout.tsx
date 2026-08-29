import React from "react";
import { PanelNav, type PanelNavGrupo } from "./PanelNav";
import type { Tema } from "./ThemeToggle";

export interface BreadcrumbItem {
  label: string;
  /** Sem href, o item é o atual da trilha e não vira link. */
  href?: string;
}

export interface PanelLayoutProps {
  nomeStaff: string;
  nomeTenant: string;
  grupos: PanelNavGrupo[];
  breadcrumb: BreadcrumbItem[];
  acao?: React.ReactNode;
  tema: Tema;
  onTemaChange: (tema: Tema) => void;
  onSair: () => void;
  /** Componente de link do consumidor (ex.: `Link` do Next). Padrão: `'a'`. */
  linkAs?: React.ElementType;
  children: React.ReactNode;
}

export function PanelLayout({
  nomeStaff,
  nomeTenant,
  grupos,
  breadcrumb,
  acao,
  tema,
  onTemaChange,
  onSair,
  linkAs,
  children,
}: PanelLayoutProps) {
  const Link: React.ElementType = linkAs ?? "a";

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <PanelNav
        nomeStaff={nomeStaff}
        nomeTenant={nomeTenant}
        grupos={grupos}
        tema={tema}
        onTemaChange={onTemaChange}
        onSair={onSair}
        linkAs={linkAs}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pr-glass sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 px-6">
          <nav aria-label="Trilha" className="min-w-0">
            <ol className="flex list-none items-center gap-1.5 p-0 font-ui text-[13px]">
              {breadcrumb.map((item, indice) => (
                <li key={`${item.label}-${indice}`} className="flex items-center gap-1.5">
                  {indice > 0 && (
                    <span aria-hidden="true" className="text-text-secondary">
                      /
                    </span>
                  )}
                  {item.href ? (
                    <Link href={item.href} className="pr-focusable text-text-secondary no-underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="truncate font-medium text-text">
                      {item.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          {acao && <div className="shrink-0">{acao}</div>}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
