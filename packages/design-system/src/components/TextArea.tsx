import React from 'react';

// Interface nomeada propositalmente (documenta a API pública do componente /
// contrato do Task 2), mesmo sem membros próprios além dos herdados de
// TextareaHTMLAttributes.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const CLASSE_BASE =
  'rounded-control border border-border-strong bg-surface text-text px-3 py-2 font-ui text-sm pr-focusable';

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={`${CLASSE_BASE}${className ? ` ${className}` : ''}`} {...props} />;
});
