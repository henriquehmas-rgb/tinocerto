'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { staffAuthClient } from '../../../lib/staff-auth-client';

export default function StaffLoginPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await staffAuthClient.login({ email: String(form.get('email')), senha: String(form.get('senha')) });
      if (staffAuthClient.isMfaChallenge(result)) {
        setMfaChallengeToken(result.mfaChallengeToken);
      } else {
        router.push('/staff/painel');
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setCarregando(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallengeToken) return;
    setErro(null);
    setCarregando(true);
    const form = new FormData(event.currentTarget);
    try {
      await staffAuthClient.loginMfa({ mfaChallengeToken, codigoTotp: String(form.get('codigoTotp')) });
      router.push('/staff/painel');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao confirmar o código');
    } finally {
      setCarregando(false);
    }
  }

  if (mfaChallengeToken) {
    return (
      <main className="max-w-md mx-auto p-8">
        <h1 className="font-display text-2xl mb-6">Confirme o código do autenticador</h1>
        <form onSubmit={handleMfaSubmit} className="space-y-4" autoComplete="off">
          <input
            name="codigoTotp"
            placeholder="Código de 6 dígitos"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full border border-border rounded-control p-2 bg-surface"
          />
          {erro && <p className="text-sm" style={{ color: 'crimson' }}>{erro}</p>}
          <button type="submit" disabled={carregando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
            {carregando ? 'Confirmando...' : 'Confirmar'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Entrar</h1>
      <form onSubmit={handleLoginSubmit} className="space-y-4" autoComplete="on">
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="senha" type="password" placeholder="Senha" required autoComplete="current-password" className="w-full border border-border rounded-control p-2 bg-surface" />
        {erro && <p className="text-sm" style={{ color: 'crimson' }}>{erro}</p>}
        <button type="submit" disabled={carregando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
