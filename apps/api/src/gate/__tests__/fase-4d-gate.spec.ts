// apps/api/src/gate/__tests__/fase-4d-gate.spec.ts
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { TenantContext } from '../../database/tenant-context';
import { ServiceAccountCrpLinkService } from '../../platform-api/service-account-crp-link.service';
import { mintStaffJwt } from '../../staff-auth/__tests__/mint-staff-jwt';

describe('Gate consolidado — Fase 4d (portal do desenvolvedor + service account com CRP)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const linkService = new ServiceAccountCrpLinkService();

  it.each(['service_account_crp_link'])('%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF', async (tabela) => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [tabela],
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);
    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = $1`,
      [tabela],
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('a coluna api_key.expira_em existe (rotação da Fase 4d aplicada)', async () => {
    const col = await adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'api_key' AND column_name = 'expira_em'`,
    );
    expect(col.rows).toHaveLength(1);
  });

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it('ponta a ponta: emissão self-service de chave + listagem por cursor SEM contato comercial, e psych:report.read gated por CRP', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    try {
      // --- setup: tenant, admin_tenant (headers de sessão), org_unit, vaga, 2 candidaturas ---
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4d Ltda','00000000000176','test-tenant-00000000000176') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4d Outro Ltda','00000000000177','test-tenant-00000000000177') RETURNING id`,
        )
      ).rows[0].id;

      const adminUser = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-gate-4d@example.com') RETURNING id`,
        [tenantId],
      );
      const recrutadorUser = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-gate-4d@example.com') RETURNING id`,
        [tenantId],
      );
      const psiAtivoUser = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-ativo-gate-4d@example.com') RETURNING id`,
        [tenantId],
      );
      await adminPool.query(
        `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo, verificado_em, verificado_por)
         VALUES ($1, $2, '555555', 'SP', true, now(), $3)`,
        [tenantId, psiAtivoUser.rows[0].id, adminUser.rows[0].id],
      );
      const psiInativoUser = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-inativo-gate-4d@example.com') RETURNING id`,
        [tenantId],
      );
      await adminPool.query(
        `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo)
         VALUES ($1, $2, '666666', 'RJ', false)`,
        [tenantId, psiInativoUser.rows[0].id],
      );

      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const requisition = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 4d', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate 4d', 'vaga-gate-4d') RETURNING id`,
        [tenantId, requisition.rows[0].id],
      );
      const applicationIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const person = await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', $2, $3) RETURNING id`,
          [`hash-gate-4d-${i}`, `Candidato Gate 4d ${i}`, `gate4d-${i}@example.com`],
        );
        const app = await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id, criado_em) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, job.rows[0].id, person.rows[0].id, new Date(Date.UTC(2026, 7, 1, 10, 0, i))],
        );
        applicationIds.push(app.rows[0].id);
      }

      // assessment_result + result_grant + consent para o teste de psych-report
      const psychPerson = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-gate-4d-psych', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Psych Gate 4d', 'gate4d-psych@example.com') RETURNING id`,
      );
      const assessmentResult = await adminPool.query<{ id: string }>(
        `INSERT INTO assessment_result (person_id, instrument_version_id, theta, se_theta, protocolo_confianca, calibracao_versao)
         VALUES ($1, gen_random_uuid(), '{"conscienciosidade":0.5}', '{"conscienciosidade":0.2}', 0.8, 'literatura-v1') RETURNING id`,
        [psychPerson.rows[0].id],
      );
      const consent = await adminPool.query<{ id: string }>(
        `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'reaproveitamento_resultado', 'consentimento') RETURNING id`,
        [psychPerson.rows[0].id, tenantId],
      );
      await adminPool.query(
        `INSERT INTO result_grant (assessment_result_id, tenant_id, consent_id) VALUES ($1, $2, $3)`,
        [assessmentResult.rows[0].id, tenantId, consent.rows[0].id],
      );

      // --- boot da aplicação Nest REAL ---
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app: INestApplication = moduleRef.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      await app.listen(0);
      const serverUrl = await app.getUrl();

      try {
        // --- 1. Emissão self-service SEM contato comercial (sessão admin_tenant) ---
        const respostaCreate = await fetch(`${serverUrl}/v1/developer/api-keys`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${mintStaffJwt({ userId: adminUser.rows[0].id, tenantId: tenantId!, roles: ['admin_tenant'] })}`,
          },
          body: JSON.stringify({ nome: 'Integração Gate 4d', scopes: ['applications:read', 'psych:report.read'] }),
        });
        expect(respostaCreate.status).toBe(201);
        const corpoCreate = (await respostaCreate.json()) as { raw_key: string; service_account_id: string; id: string };
        expect(corpoCreate.raw_key.startsWith('tnc_live_')).toBe(true);

        // Outro papel (recrutador) NÃO consegue emitir chave -- 403.
        const respostaNegada = await fetch(`${serverUrl}/v1/developer/api-keys`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${mintStaffJwt({ userId: recrutadorUser.rows[0].id, tenantId: tenantId!, roles: ['recrutador'] })}`,
          },
          body: JSON.stringify({ nome: 'Tentativa negada', scopes: ['applications:read'] }),
        });
        expect(respostaNegada.status).toBe(403);

        // --- 2. Lista candidaturas por cursor com a chave recém-emitida ---
        const respostaApplications = await fetch(`${serverUrl}/v1/applications?limit=10`, {
          headers: { authorization: `Bearer ${corpoCreate.raw_key}` },
        });
        expect(respostaApplications.status).toBe(200);
        const corpoApplications = (await respostaApplications.json()) as { data: Array<{ id: string }> };
        expect(corpoApplications.data.map((a) => a.id).sort()).toEqual([...applicationIds].sort());

        // --- 3. psych:report.read SEM vínculo de CRP -- 403 crp-nao-vinculado-ou-inativo ---
        const respostaSemVinculo = await fetch(`${serverUrl}/v1/assessment-results/${assessmentResult.rows[0].id}/psych-report`, {
          headers: { authorization: `Bearer ${corpoCreate.raw_key}` },
        });
        expect(respostaSemVinculo.status).toBe(403);
        const corpoSemVinculo = (await respostaSemVinculo.json()) as { type: string };
        expect(corpoSemVinculo.type).toBe('https://developers.tinocerto.com.br/problems/crp-nao-vinculado-ou-inativo');

        // --- 4. Vincula ao psicólogo com CRP ATIVO -- sucesso ---
        await tenantContext.run(tenantId, (client) =>
          linkService.link(client, {
            tenantId: tenantId!,
            serviceAccountId: corpoCreate.service_account_id,
            userId: psiAtivoUser.rows[0].id,
            vinculadoPor: adminUser.rows[0].id,
          }),
        );
        const respostaComVinculo = await fetch(`${serverUrl}/v1/assessment-results/${assessmentResult.rows[0].id}/psych-report`, {
          headers: { authorization: `Bearer ${corpoCreate.raw_key}` },
        });
        expect(respostaComVinculo.status).toBe(200);
        const corpoComVinculo = (await respostaComVinculo.json()) as { theta: Record<string, number> };
        expect(corpoComVinculo.theta).toEqual({ conscienciosidade: 0.5 });

        // --- 5. Revincula ao psicólogo com CRP INATIVO -- volta a 403 (o vínculo não contorna a checagem de vivacidade) ---
        await tenantContext.run(tenantId, (client) => linkService.unlink(client, { tenantId: tenantId!, serviceAccountId: corpoCreate.service_account_id }));
        await tenantContext.run(tenantId, (client) =>
          linkService.link(client, {
            tenantId: tenantId!,
            serviceAccountId: corpoCreate.service_account_id,
            userId: psiInativoUser.rows[0].id,
            vinculadoPor: adminUser.rows[0].id,
          }),
        );
        const respostaVinculoInativo = await fetch(`${serverUrl}/v1/assessment-results/${assessmentResult.rows[0].id}/psych-report`, {
          headers: { authorization: `Bearer ${corpoCreate.raw_key}` },
        });
        expect(respostaVinculoInativo.status).toBe(403);
        const corpoVinculoInativo = (await respostaVinculoInativo.json()) as { type: string };
        expect(corpoVinculoInativo.type).toBe('https://developers.tinocerto.com.br/problems/crp-nao-vinculado-ou-inativo');

        // --- 6. Docs self-hospedadas: NÃO verificadas aqui (desvio do plano) ---
        //
        // DESVIO DO PLANO (achado ao rodar este gate, Task 7): o plano original
        // incluía fetch(`${serverUrl}/v1/developer/openapi-spec/openapi.yaml`)
        // aqui, esperando 200. Investigado a fundo (via patch temporário de
        // diagnóstico em @nestjs/serve-static, revertido depois) e confirmado:
        // isso é uma incompatibilidade CONHECIDA e estrutural entre
        // @nestjs/serve-static e o padrão de boot Test.createTestingModule(...)
        // .createNestApplication() usado por este gate (e por fase-4a-gate.spec.ts
        // antes dele) -- não um bug do código desta fatia.
        //
        // O provider AbstractLoader de @nestjs/serve-static escolhe entre
        // ExpressLoader/NoopLoader dentro de um useFactory resolvido durante
        // moduleRef.compile() -- ANTES de createNestApplication() existir e
        // popular HttpAdapterHost.httpAdapter. Sem adapter ainda disponível
        // nesse momento, o factory devolve NoopLoader (register() vira no-op,
        // sem lançar erro) -- silenciosamente nenhuma rota estática é montada.
        // Isso é específico do boot via @nestjs/testing; GET /v1/developer/docs
        // (controller comum, sem ServeStaticModule) continuou funcionando
        // normalmente sob o mesmo boot, confirmando que o problema é isolado ao
        // mecanismo de arquivo estático, não à aplicação como um todo.
        //
        // Verificado por fora deste gate (Task 6, execução real via
        // `pnpm run start:dev` + curl): as três rotas
        // (GET /v1/developer/docs, GET /v1/developer/openapi-spec/openapi.yaml,
        // GET /v1/developer/docs/assets/standalone.js) devolvem 200 na aplicação
        // rodando de verdade -- é esse o ambiente que server real serve, não o
        // boot de teste. Manter a asserção aqui produziria um falso negativo
        // permanente sem exercitar bug nenhum do produto.

        // --- 7. Isolamento de tenant: chave do outro tenant nunca vê nada daqui ---
        const outroAdmin = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-outro-gate-4d@example.com') RETURNING id`,
          [outroTenantId],
        );
        const respostaOutroCreate = await fetch(`${serverUrl}/v1/developer/api-keys`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${mintStaffJwt({ userId: outroAdmin.rows[0].id, tenantId: outroTenantId!, roles: ['admin_tenant'] })}`,
          },
          body: JSON.stringify({ nome: 'Integração Outro Tenant', scopes: ['applications:read'] }),
        });
        const corpoOutroCreate = (await respostaOutroCreate.json()) as { raw_key: string };
        const respostaOutroApplications = await fetch(`${serverUrl}/v1/applications`, {
          headers: { authorization: `Bearer ${corpoOutroCreate.raw_key}` },
        });
        const corpoOutroApplications = (await respostaOutroApplications.json()) as { data: unknown[] };
        expect(corpoOutroApplications.data).toEqual([]);
      } finally {
        await app.close();
      }
    } finally {
      if (tenantId) {
        // Ordem importa (mesma precedência de FK já observada nos gates
        // anteriores): application referencia person -- application
        // precisa sumir ANTES de person, nunca depois.
        await adminPool.query('DELETE FROM service_account_crp_link WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM result_grant WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM consent WHERE tenant_id = $1`, [tenantId]);
        await adminPool.query(`DELETE FROM assessment_result WHERE person_id IN (SELECT id FROM person WHERE cpf_hash = 'hash-gate-4d-psych')`);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM person WHERE cpf_hash LIKE 'hash-gate-4d%'`);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM psicologo_credencial WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
      if (outroTenantId) {
        await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
      }
    }
  }, 60000);
});
