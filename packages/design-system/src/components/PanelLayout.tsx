import React from 'react';
import { PanelNav } from './PanelNav';

export interface PanelLayoutProps {
  nomeStaff: string;
  nomeTenant: string;
  onSair: () => void;
  children: React.ReactNode;
}

export function PanelLayout({ nomeStaff, nomeTenant, onSair, children }: PanelLayoutProps) {
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <PanelNav nomeStaff={nomeStaff} nomeTenant={nomeTenant} onSair={onSair} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
