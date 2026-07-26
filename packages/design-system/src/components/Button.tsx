import React from 'react';

export interface ButtonProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
  onClick?: () => void;
}

export function Button({ variant = 'primary', children, onClick }: ButtonProps) {
  const base = 'rounded-control px-4 py-2 font-ui text-sm font-medium pr-focusable';
  const variantClass =
    variant === 'primary'
      ? 'bg-accent text-on-accent'
      : 'bg-surface text-text border border-border';

  return (
    <button className={`${base} ${variantClass}`} onClick={onClick}>
      {children}
    </button>
  );
}
