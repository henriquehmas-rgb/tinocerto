import React from 'react';
import * as NavigationMenu from '@radix-ui/react-navigation-menu';

export interface PanelNavProps {
  nomeStaff: string;
  nomeTenant: string;
  onSair: () => void;
}

export function PanelNav({ nomeStaff, nomeTenant, onSair }: PanelNavProps) {
  return (
    <nav className="flex flex-col gap-4 p-4 border-r border-border bg-surface min-w-[200px]">
      <div>
        <p className="font-ui text-xs text-text-secondary">{nomeTenant}</p>
        <p className="font-ui text-sm font-medium text-text">{nomeStaff}</p>
      </div>
      <NavigationMenu.Root orientation="vertical">
        <NavigationMenu.List className="flex flex-col gap-1">
          <NavigationMenu.Item>
            <NavigationMenu.Link
              href="/staff/painel"
              className="block rounded-control px-3 py-2 font-ui text-sm text-text pr-focusable"
            >
              Vagas
            </NavigationMenu.Link>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>
      <button onClick={onSair} className="mt-auto rounded-control px-3 py-2 font-ui text-sm text-left border border-border pr-focusable">
        Sair
      </button>
    </nav>
  );
}
