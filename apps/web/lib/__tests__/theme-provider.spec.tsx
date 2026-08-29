import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider, useTema } from '../theme-provider';

// jsdom não implementa matchMedia; cada teste instala o seu.
function instalarMatchMedia(escuro: boolean) {
  const ouvintes = new Set<() => void>();
  const mq = {
    matches: escuro,
    addEventListener: (_evento: string, cb: () => void) => ouvintes.add(cb),
    removeEventListener: (_evento: string, cb: () => void) => ouvintes.delete(cb),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  return {
    simularMudanca(novoEscuro: boolean) {
      mq.matches = novoEscuro;
      ouvintes.forEach((cb) => cb());
    },
  };
}

function Sonda() {
  const { tema, definirTema } = useTema();
  return (
    <div>
      <span data-testid="tema">{tema}</span>
      <button type="button" onClick={() => definirTema('dark')}>
        escurecer
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sem preferência salva, usa auto e resolve pelo sistema', async () => {
    instalarMatchMedia(true);
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tema')).toHaveTextContent('auto'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('lê a preferência salva e a aplica em data-theme', async () => {
    instalarMatchMedia(false);
    window.localStorage.setItem('tinocerto:theme', 'dark');
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tema')).toHaveTextContent('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persiste a preferência ao trocar', async () => {
    instalarMatchMedia(false);
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'escurecer' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(window.localStorage.getItem('tinocerto:theme')).toBe('dark');
  });

  it('em modo auto, reage à troca de tema do sistema', async () => {
    const mm = instalarMatchMedia(false);
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    mm.simularMudanca(true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('nunca estampa o literal "auto" em data-theme', async () => {
    instalarMatchMedia(false);
    window.localStorage.setItem('tinocerto:theme', 'auto');
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('trata valor inválido no storage como auto', async () => {
    instalarMatchMedia(true);
    window.localStorage.setItem('tinocerto:theme', 'roxo');
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tema')).toHaveTextContent('auto'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('não quebra quando localStorage lança', async () => {
    instalarMatchMedia(false);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    render(
      <ThemeProvider>
        <Sonda />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tema')).toHaveTextContent('auto'));
    spy.mockRestore();
  });

  it('useTema fora de um provider devolve o padrão, sem lançar', () => {
    instalarMatchMedia(false);
    render(<Sonda />);
    expect(screen.getByTestId('tema')).toHaveTextContent('auto');
    // não lança ao chamar o setter de fallback
    fireEvent.click(screen.getByRole('button', { name: 'escurecer' }));
  });
});
