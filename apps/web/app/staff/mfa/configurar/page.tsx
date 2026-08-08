'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { staffAuthClient } from '../../../../lib/staff-auth-client';

export default function MfaConfigurarPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [qrCodeDataUri, setQrCodeDataUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!staffAuthClient.isLoggedIn()) {
      router.push('/staff/entrar');
      return;
    }
    staffAuthClient
      .mfaSetup()
      .then(({ qrCodeDataUri: uri }) => setQrCodeDataUri(uri))
      .catch((err) => setErro(err instanceof Error ? err.message : 'Erro ao iniciar a configuração de MFA'));
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);
    const form = new FormData(event.currentTarget);
    try {
      const { backupCodes: codigos } = await staffAuthClient.mfaVerify({ codigoTotp: String(form.get('codigoTotp')) });
      setBackupCodes(codigos);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao confirmar o código');
    } finally {
      setCarregando(false);
    }
  }

  if (backupCodes) {
    return (
      <main className="max-w-md mx-auto p-8">
        <h1 className="font-display text-2xl mb-6">MFA configurado com sucesso</h1>
        <p className="text-sm mb-4">
          Guarde estes códigos de backup em um local seguro. Eles não serão mostrados novamente e cada um só pode
          ser usado uma vez para entrar caso você perca acesso ao aplicativo autenticador.
        </p>
        <ul className="font-mono text-sm space-y-1 border border-border rounded-control p-4 bg-surface">
          {backupCodes.map((codigo) => (
            <li key={codigo}>{codigo}</li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Configurar autenticação em duas etapas</h1>
      {erro && <p className="text-sm mb-4" style={{ color: 'crimson' }}>{erro}</p>}
      {qrCodeDataUri && (
        <>
          <p className="text-sm mb-4">Escaneie o código abaixo com seu aplicativo autenticador (ex. Google Authenticator).</p>
          {/* data URI gerado pelo backend, não é um asset otimizável pelo next/image */}
          <img src={qrCodeDataUri} alt="QR code para configurar o autenticador" className="mb-6" />
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <input
              name="codigoTotp"
              placeholder="Código de 6 dígitos"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full border border-border rounded-control p-2 bg-surface"
            />
            <button type="submit" disabled={carregando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
              {carregando ? 'Confirmando...' : 'Confirmar'}
            </button>
          </form>
          <p className="text-sm mt-4">
            {/* Onboarding não força MFA -- fica disponível para configurar depois, a partir daqui só oferecemos o próximo passo. */}
            <Link href="/" className="underline">Pular por agora</Link>
          </p>
        </>
      )}
    </main>
  );
}
