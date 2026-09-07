import React from 'react';

// Interface nomeada propositalmente (documenta a API pública do componente /
// contrato do Task 2), mesmo sem membros próprios além dos herdados de
// InputHTMLAttributes.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const CLASSE_BASE =
  'rounded-control border border-border-strong bg-surface text-text px-3 py-2 font-ui text-sm pr-focusable';

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={`${CLASSE_BASE}${className ? ` ${className}` : ''}`} {...props} />;
});
