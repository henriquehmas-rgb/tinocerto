'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { candidateAuthClient } from '../../../lib/candidate-auth-client';

export default function RegisterPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);
    const form = new FormData(event.currentTarget);
    try {
      await candidateAuthClient.register({
        email: String(form.get('email')),
        senha: String(form.get('senha')),
        nome: String(form.get('nome')),
        cpf: String(form.get('cpf')),
      });
      router.push('/candidato/candidaturas');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Criar conta de candidato</h1>
      <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
        <input name="nome" placeholder="Nome completo" required autoComplete="name" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="cpf" placeholder="CPF" required autoComplete="off" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="senha" type="password" placeholder="Senha" required minLength={8} autoComplete="new-password" className="w-full border border-border rounded-control p-2 bg-surface" />
        {erro && <p className="text-sm" style={{ color: 'crimson' }}>{erro}</p>}
        <button type="submit" disabled={carregando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
          {carregando ? 'Criando...' : 'Criar conta'}
        </button>
      </form>
    </main>
  );
}
