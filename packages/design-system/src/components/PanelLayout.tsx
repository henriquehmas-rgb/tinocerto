import React from "react";
import { PanelNav, PanelNavLink } from "./PanelNav";

export interface PanelLayoutProps {
  nomeStaff: string;
  nomeTenant: string;
  links: PanelNavLink[];
  onSair: () => void;
  children: React.ReactNode;
}

export function PanelLayout({ nomeStaff, nomeTenant, links, onSair, children }: PanelLayoutProps) {
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <PanelNav nomeStaff={nomeStaff} nomeTenant={nomeTenant} links={links} onSair={onSair} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
