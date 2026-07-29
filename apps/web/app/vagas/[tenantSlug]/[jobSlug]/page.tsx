import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiServerFetch } from '../../../../lib/api-server';

interface CampoCustomizado {
  id: string;
  label: string;
  tipoCampo: string;
  faseColeta: string;
}

interface PublicJobDetail {
  id: string;
  titulo: string;
  descricao: string;
  seoSlug: string;
  publicadoEm: string;
  camposCustomizados: CampoCustomizado[];
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; jobSlug: string }>;
}) {
  const { tenantSlug, jobSlug } = await params;
  const job = await apiServerFetch<PublicJobDetail>(
    `/v1/public/careers/${tenantSlug}/jobs/${jobSlug}`,
  );

  if (job === null) {
    notFound();
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link href={`/vagas/${tenantSlug}`} className="text-text-secondary text-sm">
        &larr; Voltar às vagas
      </Link>
      <h1 className="font-display text-3xl mt-4 mb-4">{job.titulo}</h1>
      <p className="text-text whitespace-pre-wrap">{job.descricao}</p>
      <Link
        href={`/vagas/${tenantSlug}/${job.seoSlug}/candidatar`}
        className="inline-block mt-6 rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium"
      >
        Candidatar-se
      </Link>
    </main>
  );
}
