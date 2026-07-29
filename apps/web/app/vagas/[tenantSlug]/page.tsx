import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServerFetch } from '../../../lib/api-server';

interface PublicJobSummary {
  id: string;
  titulo: string;
  seoSlug: string;
  publicadoEm: string;
}

export default async function CareersListPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const jobs = await apiServerFetch<PublicJobSummary[]>(`/v1/public/careers/${tenantSlug}/jobs`);

  if (jobs === null) {
    notFound();
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="font-display text-3xl mb-6">Vagas abertas</h1>
      {jobs.length === 0 && <p className="text-text-secondary">Nenhuma vaga publicada no momento.</p>}
      <ul className="space-y-4">
        {jobs.map((job) => (
          <li key={job.id} className="border border-border rounded-card p-4 bg-surface">
            <Link href={`/vagas/${tenantSlug}/${job.seoSlug}`} className="font-ui text-lg text-accent">
              {job.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
