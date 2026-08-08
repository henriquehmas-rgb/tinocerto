'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { staffAuthClient } from '../../../lib/staff-auth-client';

export default function CadastrarEmpresaPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);
    const form = new FormData(event.currentTarget);
    try {
      await staffAuthClient.onboard({
        nomeEmpresa: String(form.get('nomeEmpresa')),
        cnpj: String(form.get('cnpj')),
        emailAdmin: String(form.get('emailAdmin')),
        senhaAdmin: String(form.get('senhaAdmin')),
      });
      router.push('/staff/mfa/configurar');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar a conta da empresa');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Cadastrar empresa</h1>
      <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
        <input name="nomeEmpresa" placeholder="Nome da empresa" required autoComplete="organization" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="cnpj" placeholder="CNPJ" required autoComplete="off" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="emailAdmin" type="email" placeholder="E-mail do administrador" required autoComplete="email" className="w-full border border-border rounded-control p-2 bg-surface" />
        <input name="senhaAdmin" type="password" placeholder="Senha" required minLength={8} autoComplete="new-password" className="w-full border border-border rounded-control p-2 bg-surface" />
        {erro && <p className="text-sm" style={{ color: 'crimson' }}>{erro}</p>}
        <button type="submit" disabled={carregando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
          {carregando ? 'Criando...' : 'Criar conta da empresa'}
        </button>
      </form>
    </main>
  );
}
