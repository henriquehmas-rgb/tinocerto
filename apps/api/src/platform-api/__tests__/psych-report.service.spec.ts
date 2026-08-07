// apps/api/src/platform-api/__tests__/psych-report.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PsychReportService } from '../psych-report.service';

describe('PsychReportService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const service = new PsychReportService();

  let tenantId: string;
  let personId: string;
  let assessmentResultId: string;
  let consentId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Psych Report Ltda','00000000000173','test-tenant-00000000000173') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-psych-173', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato 173', 'psych173@example.com') RETURNING id`,
    );
    personId = person.rows[0].id;

    const result = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_result (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, calibracao_versao)
       VALUES ($1, gen_random_uuid(), '{"conscienciosidade":0.8}', '{"conscienciosidade":0.3}', '{"conscienciosidade":6}', 0.90, 'literatura-v1')
       RETURNING id`,
      [personId],
    );
    assessmentResultId = result.rows[0].id;

    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'reaproveitamento_resultado', 'consentimento') RETURNING id`,
      [personId, tenantId],
    );
    consentId = consent.rows[0].id;

    await adminPool.query(
      `INSERT INTO result_grant (assessment_result_id, tenant_id, consent_id) VALUES ($1, $2, $3)`,
      [assessmentResultId, tenantId, consentId],
    );
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM result_grant WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM consent WHERE id = $1', [consentId]);
    await adminPool.query('DELETE FROM assessment_result WHERE id = $1', [assessmentResultId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-psych-173'`);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('com grant vivo, devolve os campos brutos (theta/se_theta/escore_bruto/protocolo_confianca/calibracao_versao)', async () => {
    const raw = await tenantContext.run(tenantId, (client) => service.obterIntegra(client, assessmentResultId));
    expect(raw).toEqual({
      assessmentResultId,
      theta: { conscienciosidade: 0.8 },
      seTheta: { conscienciosidade: 0.3 },
      escoreBruto: { conscienciosidade: 6 },
      protocoloConfianca: 0.9,
      calibracaoVersao: 'literatura-v1',
    });
  });

  it('result_grant revogado bloqueia a leitura (404, mesmo padrão anti-oráculo)', async () => {
    await adminPool.query(`UPDATE result_grant SET revoked_at = now() WHERE assessment_result_id = $1`, [assessmentResultId]);
    await expect(
      tenantContext.run(tenantId, (client) => service.obterIntegra(client, assessmentResultId)),
    ).rejects.toThrow();
    await adminPool.query(`UPDATE result_grant SET revoked_at = NULL WHERE assessment_result_id = $1`, [assessmentResultId]);
  });

  it('consent revogado bloqueia a leitura mesmo com result_grant vivo', async () => {
    await adminPool.query(`UPDATE consent SET revoked_at = now() WHERE id = $1`, [consentId]);
    await expect(
      tenantContext.run(tenantId, (client) => service.obterIntegra(client, assessmentResultId)),
    ).rejects.toThrow();
    await adminPool.query(`UPDATE consent SET revoked_at = NULL WHERE id = $1`, [consentId]);
  });

  it('isolamento de tenant: outro tenant não enxerga o resultado', async () => {
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Psych Report Outro Ltda','00000000000174','test-tenant-00000000000174') RETURNING id`,
    );
    try {
      await expect(
        tenantContext.run(outro.rows[0].id, (client) => service.obterIntegra(client, assessmentResultId)),
      ).rejects.toThrow();
    } finally {
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [outro.rows[0].id]);
    }
  });
});
