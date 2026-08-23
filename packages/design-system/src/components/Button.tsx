import React from 'react';

export interface ButtonProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

export function Button({ variant = 'primary', children, onClick, disabled, type = 'button' }: ButtonProps) {
  const base = 'rounded-control px-4 py-2 font-ui text-sm font-medium pr-focusable disabled:opacity-50 disabled:cursor-not-allowed';
  const variantClass =
    variant === 'primary'
      ? 'bg-accent text-on-accent'
      : 'bg-surface text-text border border-border';

  return (
    <button type={type} className={`${base} ${variantClass}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
