import React, { useEffect } from "react";

export interface ToastProps {
  mensagem: string;
  acao?: { rotulo: string; onClick: () => void };
  aoFechar: () => void;
  duracaoMs?: number;
}

export function Toast({ mensagem, acao, aoFechar, duracaoMs = 6000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(aoFechar, duracaoMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line -- aoFechar/duracaoMs
    // vêm do chamador a cada render; reiniciar o timer a cada mudança de
    // referência faria o toast nunca fechar se o pai re-renderizasse antes
    // do prazo. O timer é montado uma vez por instância do Toast.
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pr-glass fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-panel px-4 py-3 font-ui text-sm text-text"
      style={{ boxShadow: "var(--pr-shadow-float)", transitionDuration: "var(--pr-dur-micro)" }}
    >
      <span>{mensagem}</span>
      {acao && (
        <button
          type="button"
          onClick={acao.onClick}
          className="pr-focusable font-ui text-sm font-semibold underline"
          style={{ color: "var(--pr-accent-text)" }}
        >
          {acao.rotulo}
        </button>
      )}
    </div>
  );
}
