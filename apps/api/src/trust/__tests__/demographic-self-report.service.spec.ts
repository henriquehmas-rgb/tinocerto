import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { DemographicSelfReportService } from '../demographic-self-report.service';

describe('DemographicSelfReportService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let outroTenantId: string;
  let personId: string;
  let outraPessoaId: string;
  let consentId: string;
  let consentDeOutraFinalidadeId: string;
  let consentDeOutraPessoaId: string;
  let consentDeOutroTenantId: string;
  let consentDePlataformaId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Diversidade', '00000000000066', 'test-tenant-00000000000066') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Diversidade Outro', '00000000000072', 'test-tenant-00000000000072') RETURNING id`,
    );
    outroTenantId = outro.rows[0].id;
    const p = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-diversidade', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Diversidade', 'diversidade@example.com')
       RETURNING id`,
    );
    personId = p.rows[0].id;
    const outraP = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-diversidade-outra', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Outra Pessoa Diversidade', 'outra.diversidade@example.com')
       RETURNING id`,
    );
    outraPessoaId = outraP.rows[0].id;
    const c = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [personId, tenantId],
    );
    consentId = c.rows[0].id;
    const cErrado = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'processo_seletivo', 'legitimo_interesse') RETURNING id`,
      [personId, tenantId],
    );
    consentDeOutraFinalidadeId = cErrado.rows[0].id;
    const cOutraPessoa = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [outraPessoaId, tenantId],
    );
    consentDeOutraPessoaId = cOutraPessoa.rows[0].id;
    const cOutroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [personId, outroTenantId],
    );
    consentDeOutroTenantId = cOutroTenant.rows[0].id;
    const cPlataforma = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, finalidade, base_legal) VALUES ($1, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [personId],
    );
    consentDePlataformaId = cPlataforma.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM demographic_self_report WHERE tenant_id = ANY($1)', [[tenantId, outroTenantId]]);
    await adminPool.query('DELETE FROM consent WHERE person_id = ANY($1)', [[personId, outraPessoaId]]);
    await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [[personId, outraPessoaId]]);
    await adminPool.query('DELETE FROM tenant WHERE id = ANY($1)', [[tenantId, outroTenantId]]);
    await adminPool.end();
    await appPool.end();
  });

  it('declara autodeclaração com consentimento válido de autodeclaracao_diversidade', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await ctx.run(tenantId, (client) =>
      service.declarar(client, {
        tenantId,
        personId,
        genero: 'feminino',
        racaCor: 'preta',
        faixaEtaria: '40_mais',
        pcd: false,
        consentId,
      }),
    );

    const row = await adminPool.query('SELECT * FROM demographic_self_report WHERE tenant_id = $1 AND person_id = $2', [
      tenantId,
      personId,
    ]);
    expect(row.rows[0].genero).toBe('feminino');
    expect(row.rows[0].raca_cor).toBe('preta');
    expect(row.rows[0].pcd).toBe(false);
  });

  it('declarar de novo SUBSTITUI a autodeclaração anterior (upsert por tenant_id+person_id)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await ctx.run(tenantId, (client) =>
      service.declarar(client, { tenantId, personId, genero: 'feminino', consentId }),
    );
    await ctx.run(tenantId, (client) =>
      service.declarar(client, { tenantId, personId, genero: 'masculino', consentId }),
    );

    const row = await adminPool.query('SELECT genero FROM demographic_self_report WHERE tenant_id = $1 AND person_id = $2', [
      tenantId,
      personId,
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].genero).toBe('masculino');
  });

  it('rejeita quando o consentimento não é de finalidade autodeclaracao_diversidade', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, { tenantId, personId, genero: 'feminino', consentId: consentDeOutraFinalidadeId }),
      ),
    ).rejects.toThrow(/autodeclaração de diversidade/);
  });

  it('rejeita consentimento inexistente', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, {
          tenantId,
          personId,
          genero: 'feminino',
          consentId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(/não encontrado/);
  });

  it('rejeita consentimento revogado', async () => {
    const revogado = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal, revoked_at) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento', now()) RETURNING id`,
      [personId, tenantId],
    );
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, { tenantId, personId, genero: 'feminino', consentId: revogado.rows[0].id }),
      ),
    ).rejects.toThrow(/revogado/);

    await adminPool.query('DELETE FROM consent WHERE id = $1', [revogado.rows[0].id]);
  });

  it('rejeita consentimento de OUTRA pessoa, mesmo tenant', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, { tenantId, personId, genero: 'feminino', consentId: consentDeOutraPessoaId }),
      ),
    ).rejects.toThrow(/não pertence a este candidato\/tenant/);
  });

  it('rejeita consentimento de OUTRO tenant, mesma pessoa -- RLS de consent já esconde a linha', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, { tenantId, personId, genero: 'feminino', consentId: consentDeOutroTenantId }),
      ),
    ).rejects.toThrow(/não encontrado/);
  });

  it('rejeita consentimento de ESCOPO DE PLATAFORMA (tenant_id NULL) -- autodeclaração exige consentimento específico deste tenant', async () => {
    // Diferente de result_grant (que aceita consent de plataforma para
    // reaproveitamento de resultado entre tenants), autodeclaração
    // demográfica não tem esse caso de uso -- dado sensível pede
    // consentimento ESPECÍFICO, não uma base legal larga o bastante para
    // servir qualquer tenant.
    const ctx = new TenantContext(appPool);
    const service = new DemographicSelfReportService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.declarar(client, { tenantId, personId, genero: 'feminino', consentId: consentDePlataformaId }),
      ),
    ).rejects.toThrow(/não pertence a este candidato\/tenant/);
  });

  it('o trigger do banco barra INSERT direto (bypass do serviço) apontando para consent de outro tenant', async () => {
    // Achado de revisão adversarial da Task 1: o serviço não é o único
    // caminho de escrita possível (as próprias Tasks 4/5 deste plano
    // inserem via SQL cru em fixture de teste). O trigger
    // trg_demographic_self_report_consent_mesmo_tenant é o backstop real,
    // que nenhum controle de aplicação pode contornar -- testado aqui via
    // adminPool (rolbypassrls), a mesma conexão que ignoraria RLS mas não
    // ignora trigger.
    await expect(
      adminPool.query(
        `INSERT INTO demographic_self_report (tenant_id, person_id, genero, consent_id) VALUES ($1, $2, 'feminino', $3)`,
        [tenantId, personId, consentDeOutroTenantId],
      ),
    ).rejects.toThrow(/autodeclaracao exige consentimento especifico|especifico deste tenant/i);
  });
});
