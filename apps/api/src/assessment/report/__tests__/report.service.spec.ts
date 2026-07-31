import { Pool } from 'pg';
import { ReportService, RODAPE_OBRIGATORIO } from '../report.service';
import { classificarTermosClinicos } from '../clinical-vocabulary-linter';

describe('ReportService (trilho A)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';
  let personId: string;
  let resultId: string;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-report','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Relatorio Teste','report@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const r = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_result
         (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, respondido_em, calibracao_versao)
       VALUES ($1,$2,$3,$4,$3,0.62,now(),'literatura_v1') RETURNING id`,
      [
        personId,
        VERSION_ID,
        JSON.stringify({ conscienciosidade: 0.8, extroversao: -0.3, amabilidade: 0.1, estabilidade: 0.5, abertura: -0.2 }),
        JSON.stringify({ conscienciosidade: 0.35, extroversao: 0.4, amabilidade: 0.42, estabilidade: 0.38, abertura: 0.45 }),
      ],
    );
    resultId = r.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM assessment_result WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
  });

  it('gera relatório com uma seção por dimensão e o rodapé obrigatório', async () => {
    const relatorio = await new ReportService().gerar(adminPool, resultId);

    expect(relatorio.secoes).toHaveLength(5);
    expect(relatorio.rodape).toBe(RODAPE_OBRIGATORIO);
    expect(relatorio.rodape).toMatch(/não constitui avaliação psicológica/i);
  });

  it('o corpo do relatório não contém nenhum termo clínico', async () => {
    const relatorio = await new ReportService().gerar(adminPool, resultId);

    const corpo = relatorio.secoes.map((s) => `${s.titulo} ${s.texto}`).join(' ');
    expect(classificarTermosClinicos(corpo)).toEqual([]);
  });

  it('NÃO expõe percentil em nenhum campo do payload', async () => {
    const relatorio = await new ReportService().gerar(adminPool, resultId);
    const serializado = JSON.stringify(relatorio).toLowerCase();

    expect(serializado).not.toContain('percentil');
    expect(serializado).not.toContain('percentile');
  });

  it('marca explicitamente que a calibração ainda é provisória', async () => {
    const relatorio = await new ReportService().gerar(adminPool, resultId);
    expect(relatorio.calibracaoProvisoria).toBe(true);
    expect(relatorio.avisoCalibracao).toMatch(/provis/i);
  });

  it('lança se o resultado não existir, em vez de gerar relatório vazio', async () => {
    await expect(
      new ReportService().gerar(adminPool, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/não encontrado/i);
  });
});
