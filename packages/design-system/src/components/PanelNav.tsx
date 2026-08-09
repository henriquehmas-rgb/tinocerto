import React from "react";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";

export interface PanelNavLink {
  href: string;
  label: string;
}

export interface PanelNavProps {
  nomeStaff: string;
  nomeTenant: string;
  links: PanelNavLink[];
  onSair: () => void;
}

export function PanelNav({ nomeStaff, nomeTenant, links, onSair }: PanelNavProps) {
  return (
    <nav className="flex flex-col gap-4 p-4 border-r border-border bg-surface min-w-[200px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- componente de pacote compartilhado, fora do contexto de otimização de imagem do Next; /logo.svg é servido pela pasta public/ do app consumidor (apps/web). */}
      <img src="/logo.svg" alt="Tinocerto" className="h-6 w-auto" />
      <div>
        <p className="font-ui text-xs text-text-secondary">{nomeTenant}</p>
        <p className="font-ui text-sm font-medium text-text">{nomeStaff}</p>
      </div>
      <NavigationMenu.Root orientation="vertical">
        <NavigationMenu.List className="flex flex-col gap-1">
          {links.map((link) => (
            <NavigationMenu.Item key={link.href}>
              <NavigationMenu.Link
                href={link.href}
                className="block rounded-control px-3 py-2 font-ui text-sm text-text pr-focusable"
              >
                {link.label}
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>
      <button onClick={onSair} className="mt-auto rounded-control px-3 py-2 font-ui text-sm text-left border border-border pr-focusable">
        Sair
      </button>
    </nav>
  );
}
