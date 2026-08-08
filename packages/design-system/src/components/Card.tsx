import React from 'react';

export interface CardProps {
  children: React.ReactNode;
}

export function Card({ children }: CardProps) {
  return <div className="rounded-panel border border-border bg-surface p-3">{children}</div>;
}
