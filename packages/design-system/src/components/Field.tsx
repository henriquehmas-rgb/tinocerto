import React from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  erro?: string;
  htmlFor: string;
  children: React.ReactNode;
}

export function Field({ label, hint, erro, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-ui text-sm text-text">
        {label}
      </label>
      {children}
      {hint && !erro && <p className="font-ui text-xs text-text-secondary">{hint}</p>}
      {erro && <p className="font-ui text-xs text-danger-text">{erro}</p>}
    </div>
  );
}
