import React, { useState } from 'react';
import { X } from 'lucide-react';

export interface ChipsInputProps {
  valores: string[];
  onChange: (proximo: string[]) => void;
  placeholder?: string;
  /** Repassado ao `<input>` interno -- é o que permite um `<label htmlFor>` externo (ver `Field`) apontar para este componente. */
  id?: string;
}

export function ChipsInput({ valores, onChange, placeholder, id }: ChipsInputProps) {
  const [texto, setTexto] = useState('');

  function adicionar(bruto: string) {
    const valor = bruto.trim();
    if (!valor || valores.includes(valor)) return;
    onChange([...valores, valor]);
    setTexto('');
  }

  function remover(valor: string) {
    onChange(valores.filter((v) => v !== valor));
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter' || evento.key === ',') {
      evento.preventDefault();
      adicionar(texto);
      return;
    }
    if (evento.key === 'Backspace' && texto === '' && valores.length > 0) {
      onChange(valores.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-control border border-border-strong bg-surface px-2 py-1.5">
      {valores.map((valor) => (
        <span
          key={valor}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 font-ui text-[11px] text-text-secondary"
          style={{ background: 'var(--pr-surface-sunken)' }}
        >
          {valor}
          <button
            type="button"
            aria-label={`Remover ${valor}`}
            onClick={() => remover(valor)}
            className="pr-focusable rounded-full"
          >
            <X size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className="min-w-[80px] flex-1 border-none bg-transparent font-ui text-sm text-text outline-none"
        value={texto}
        placeholder={valores.length === 0 ? placeholder : undefined}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={aoTeclar}
      />
    </div>
  );
}
