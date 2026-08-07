import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

describe('Gate consolidado — Fase 1b (Experiência Pública do Candidato)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const API_ROOT = path.resolve(__dirname, '../../..');

  afterAll(async () => {
    await adminPool.end();
  });

  // [Fase 3d] candidate_application_summary SAIU desta lista --
  // resume_0006__candidate_application_summary_tenant_id.sql reintroduz
  // tenant_id deliberadamente (CandidateEvaluationViewService precisa
  // resolver o tenant de uma application_id antes de ler
  // decision/offer/pipeline_stage_transition, todas tenant-scoped com RLS
  // FORCE). A remoção original (resume_0005, Fase 1b) foi correta para o
  // problema daquele momento -- a coluna nunca era lida de volta; o
  // cálculo muda porque agora existe um consumidor real. Ver a migration
  // resume_0006 e a design spec da Fase 3d (Decisão 6) para o raciocínio
  // completo -- não é a mesma dívida voltando, é a mesma disciplina de
  // "remover o que não é usado" aplicada ao inverso quando o uso aparece.
  const GLOBAL_TABLES_SEM_TENANT_ID = [
    'candidate_account',
    'candidate_refresh_token',
    'candidate_password_reset_token',
    'resume_upload',
  ];

  it.each(GLOBAL_TABLES_SEM_TENANT_ID)('%s é global de propósito (sem tenant_id) — exceção documentada', async (table) => {
    const result = await adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
      [table],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('tenant.slug é UNIQUE e NOT NULL (base da resolução pública de tenant)', async () => {
    const notNull = await adminPool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'tenant' AND column_name = 'slug'`,
    );
    expect(notNull.rows[0].is_nullable).toBe('NO');

    const unique = await adminPool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'tenant'::regclass AND contype = 'u' AND conname = 'uq_tenant_slug'`,
    );
    expect(unique.rows).toHaveLength(1);
  });

  it('candidate_account.senha_hash nunca é texto puro -- todo hash existente usa o prefixo argon2id', async () => {
    const result = await adminPool.query<{ senha_hash: string }>(`SELECT senha_hash FROM candidate_account LIMIT 50`);
    for (const row of result.rows) {
      expect(row.senha_hash.startsWith('$argon2id$')).toBe(true);
    }
  });

  it('candidate_refresh_token.token_hash nunca é o token em claro -- todo valor tem exatamente 64 caracteres hexadecimais (SHA-256)', async () => {
    const result = await adminPool.query<{ token_hash: string }>(`SELECT token_hash FROM candidate_refresh_token LIMIT 50`);
    for (const row of result.rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('TenantResolutionMiddleware (staff) exclui explicitamente as rotas de candidato e públicas', async () => {
    const content = await readFile(path.join(API_ROOT, 'src/app.module.ts'), 'utf-8');
    expect(content).toContain("'v1/candidate/(.*)'");
    expect(content).toContain("'v1/public/(.*)'");
  });

  it('nenhuma rota de candidato/pública usa CerbosGuard (staff) -- só CandidateAuthGuard ou nenhum guard', async () => {
    const candidateFiles = [
      'src/candidate-auth/candidate-auth.controller.ts',
      'src/candidate-auth/candidate-application.controller.ts',
    ];
    const publicFiles = ['src/public/public.controller.ts', 'src/public/public-application.controller.ts'];

    for (const file of [...candidateFiles, ...publicFiles]) {
      const content = await readFile(path.join(API_ROOT, file), 'utf-8');
      expect(content).not.toContain('CerbosGuard');
    }
  });

  it('PublicApplicationService rejeita qualquer mimetype que não seja application/pdf', async () => {
    const content = await readFile(path.join(API_ROOT, 'src/public/public-application.service.ts'), 'utf-8');
    expect(content).toContain("mimetype !== 'application/pdf'");
  });

  it('ResumeStructuringService nunca envia o PDF bruto para a Claude -- só texto já extraído', async () => {
    const content = await readFile(path.join(API_ROOT, 'src/resume/resume-structuring.service.ts'), 'utf-8');
    expect(content).not.toMatch(/type:\s*['"]document['"]/);
    expect(content).not.toMatch(/media_type:\s*['"]application\/pdf['"]/);
  });

  it('EmailService é um stub documentado (loga, não envia de verdade) -- dívida técnica explícita, não esquecida', async () => {
    const content = await readFile(path.join(API_ROOT, 'src/candidate-auth/email.service.ts'), 'utf-8');
    expect(content.toLowerCase()).toMatch(/stub/);
  });
});
