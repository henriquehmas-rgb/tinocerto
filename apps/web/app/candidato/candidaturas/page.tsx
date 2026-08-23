'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { candidateAuthClient } from '../../../lib/candidate-auth-client';

interface CandidateApplicationSummaryView {
  applicationId: string;
  jobTitulo: string;
  etapaFunil: string;
  reprovadoEm: string | null;
}

const ETAPA_LABEL: Record<string, string> = {
  triagem: 'Em triagem',
  entrevista: 'Em entrevista',
};

export default function MyApplicationsPage() {
  const router = useRouter();
  const [applications, setApplications] = useState<CandidateApplicationSummaryView[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!candidateAuthClient.isLoggedIn()) {
      router.replace('/candidato/entrar');
      return;
    }
    candidateAuthClient
      .authenticatedFetch('/v1/candidate/applications')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Não foi possível carregar suas candidaturas'))))
      .then(setApplications)
      .catch((err) => setErro(err.message));
  }, [router]);

  if (erro) return <main className="max-w-2xl mx-auto p-8">{erro}</main>;
  if (applications === null) return <main className="max-w-2xl mx-auto p-8">Carregando...</main>;

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Minhas candidaturas</h1>
      {applications.length === 0 && <p className="text-text-secondary">Você ainda não se candidatou a nenhuma vaga.</p>}
      <ul className="space-y-3">
        {applications.map((app) => (
          <li key={app.applicationId} className="border border-border rounded-card p-4 bg-surface">
            <Link href={`/candidato/candidaturas/${app.applicationId}`} className="block">
              <p className="font-ui font-medium">{app.jobTitulo}</p>
              <p className="text-sm text-text-secondary">
                {app.reprovadoEm ? 'Não seguiu nesta etapa' : (ETAPA_LABEL[app.etapaFunil] ?? app.etapaFunil)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
