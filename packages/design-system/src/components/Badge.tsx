import React from 'react';

export interface BadgeProps {
  tone: 'neutro' | 'sucesso' | 'alerta';
  children: React.ReactNode;
}

const TONE_CLASS: Record<BadgeProps['tone'], string> = {
  neutro: 'bg-surface text-text border border-border',
  sucesso: 'bg-success-bg text-success-text',
  alerta: 'bg-warning-bg text-warning-text',
};

export function Badge({ tone, children }: BadgeProps) {
  return (
    <span className={`inline-block rounded-control px-2 py-0.5 font-ui text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
