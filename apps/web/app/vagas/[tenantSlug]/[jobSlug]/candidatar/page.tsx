'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { candidateAuthClient } from '../../../../../lib/candidate-auth-client';

interface CampoCustomizado {
  id: string;
  label: string;
  faseColeta: string;
}

interface PublicJobDetail {
  id: string;
  titulo: string;
  camposCustomizados: CampoCustomizado[];
}

export default function ApplyPage() {
  const params = useParams<{ tenantSlug: string; jobSlug: string }>();
  const router = useRouter();
  const [job, setJob] = useState<PublicJobDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!candidateAuthClient.isLoggedIn()) {
      router.replace(`/candidato/entrar?redirect=/vagas/${params.tenantSlug}/${params.jobSlug}/candidatar`);
      return;
    }
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/public/careers/${params.tenantSlug}/jobs/${params.jobSlug}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Vaga não encontrada'))))
      .then(setJob)
      .catch((err) => setErro(err.message));
  }, [params.tenantSlug, params.jobSlug, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) return;
    setErro(null);
    setEnviando(true);

    const form = event.currentTarget;
    const curriculo = (form.elements.namedItem('curriculo') as HTMLInputElement).files?.[0];
    if (!curriculo) {
      setErro('Anexe seu currículo em PDF');
      setEnviando(false);
      return;
    }

    const camposInscricao = job.camposCustomizados.filter((c) => c.faseColeta === 'inscricao');
    const respostasInscricao = camposInscricao.map((campo) => ({
      jobCustomFieldId: campo.id,
      valor: String(new FormData(form).get(`campo_${campo.id}`) ?? ''),
    }));

    const body = new FormData();
    body.append('curriculo', curriculo);
    body.append('respostasInscricao', JSON.stringify(respostasInscricao));

    try {
      const response = await candidateAuthClient.authenticatedFetch(
        `/v1/public/careers/${params.tenantSlug}/jobs/${job.id}/apply`,
        { method: 'POST', body },
      );
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.message ?? 'Não foi possível enviar a candidatura');
      }
      const { applicationId, assessmentId }: { applicationId: string; assessmentId: string | null } =
        await response.json();
      if (assessmentId) {
        router.push(`/candidato/candidaturas/${applicationId}/assessment`);
      } else {
        router.push('/candidato/candidaturas');
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar candidatura');
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !job) return <main className="max-w-md mx-auto p-8">{erro}</main>;
  if (!job) return <main className="max-w-md mx-auto p-8">Carregando...</main>;

  return (
    <main className="max-w-md mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Candidatar-se: {job.titulo}</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-text-secondary">Currículo (PDF)</span>
          <input name="curriculo" type="file" accept="application/pdf" className="block w-full mt-1" />
        </label>
        {job.camposCustomizados
          .filter((campo) => campo.faseColeta === 'inscricao')
          .map((campo) => (
            <label key={campo.id} className="block">
              <span className="text-sm text-text-secondary">{campo.label}</span>
              <input name={`campo_${campo.id}`} required className="w-full border border-border rounded-control p-2 bg-surface mt-1" />
            </label>
          ))}
        {erro && <p className="text-sm" style={{ color: 'crimson' }}>{erro}</p>}
        <button type="submit" disabled={enviando} className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium">
          {enviando ? 'Enviando...' : 'Enviar candidatura'}
        </button>
      </form>
    </main>
  );
}
