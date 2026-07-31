import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { ReportService, RODAPE_OBRIGATORIO, ROTULOS, RelatorioTrilhoA } from '../report.service';
import { classificarTermosClinicos } from '../clinical-vocabulary-linter';

describe('ReportService (trilho A)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';
  let tenantComGrant: string;
  let tenantSemGrant: string;
  let personId: string;
  let consentId: string;
  let resultId: string;
  let resultExtremosId: string;
  let resultSemConfiancaId: string;
  let resultSeIncompletoId: string;
  let resultCalibradoId: string;

  /**
   * `escore_bruto` NÃO é uma cópia de theta -- é a contagem de endosso
   * chaveada (ver mfc-scoring.ts). O fixture grava os dois com valores
   * distintos de propósito: é o que permite provar que o relatório publica
   * theta, e não a contagem, sob um nome que não confunde os dois.
   */
  async function inserirResultado(
    theta: Record<string, number>,
    seTheta: Record<string, number>,
    confianca: number | null,
    escoreBrutoObservado?: Record<string, number>,
    calibracaoVersao = 'literatura_v1',
  ): Promise<string> {
    const contagens =
      escoreBrutoObservado ??
      Object.fromEntries(Object.entries(theta).map(([d, v]) => [d, Math.round(v * 10)]));
    const r = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_result
         (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, respondido_em, calibracao_versao)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7) RETURNING id`,
      [
        personId,
        VERSION_ID,
        JSON.stringify(theta),
        JSON.stringify(seTheta),
        JSON.stringify(contagens),
        confianca,
        calibracaoVersao,
      ],
    );
    return r.rows[0].id;
  }

  async function conceder(assessmentResultId: string, tenantId: string, extras: { revoked?: boolean; expirado?: boolean } = {}): Promise<string> {
    const g = await adminPool.query<{ id: string }>(
      `INSERT INTO result_grant (assessment_result_id, tenant_id, consent_id, revoked_at, expires_at)
       VALUES ($1,$2,$3, CASE WHEN $4::boolean THEN now() ELSE NULL END,
                          CASE WHEN $5::boolean THEN now() - interval '1 day' ELSE NULL END)
       RETURNING id`,
      [assessmentResultId, tenantId, consentId, extras.revoked ?? false, extras.expirado ?? false],
    );
    return g.rows[0].id;
  }

  function gerarComo(tenantId: string, assessmentResultId: string): Promise<RelatorioTrilhoA> {
    return tenantContext.run(tenantId, (client) => new ReportService().gerar(client, assessmentResultId));
  }

  function secao(relatorio: RelatorioTrilhoA, dimensao: string) {
    const encontrada = relatorio.secoes.find((s) => s.dimensao === dimensao);
    if (!encontrada) throw new Error(`seção ${dimensao} ausente no relatório`);
    return encontrada;
  }

  beforeAll(async () => {
    const tA = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Empresa Relatorio Com Grant', '00000000000055', 'test-tenant-00000000000055') RETURNING id`,
    );
    tenantComGrant = tA.rows[0].id;
    const tB = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Empresa Relatorio Sem Grant', '00000000000056', 'test-tenant-00000000000056') RETURNING id`,
    );
    tenantSemGrant = tB.rows[0].id;

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-report','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Relatorio Teste','report@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, finalidade, base_legal)
       VALUES ($1, 'reaproveitamento_resultado', 'consentimento_especifico') RETURNING id`,
      [personId],
    );
    consentId = consent.rows[0].id;

    resultId = await inserirResultado(
      { conscienciosidade: 0.8, extroversao: -0.3, amabilidade: 0.1, estabilidade: 0.5, abertura: -0.2 },
      { conscienciosidade: 0.35, extroversao: 0.4, amabilidade: 0.42, estabilidade: 0.38, abertura: 0.45 },
      0.62,
      { conscienciosidade: 8, extroversao: -3, amabilidade: 1, estabilidade: 5, abertura: -2 },
    );

    // Cobre a faixa BAIXA e as duas BORDAS do corte, que o fixture acima
    // não alcança: nele nenhum theta é < -0.5 e nenhum é exatamente ±0.5.
    resultExtremosId = await inserirResultado(
      { conscienciosidade: -0.8, extroversao: 0.51, amabilidade: -0.5, estabilidade: 0.5, abertura: -0.51 },
      { conscienciosidade: 0.3, extroversao: 0.31, amabilidade: 0.32, estabilidade: 0.33, abertura: 0.34 },
      0.71,
    );

    resultSemConfiancaId = await inserirResultado(
      { conscienciosidade: 0.2, extroversao: 0.2, amabilidade: 0.2, estabilidade: 0.2, abertura: 0.2 },
      { conscienciosidade: 0.3, extroversao: 0.3, amabilidade: 0.3, estabilidade: 0.3, abertura: 0.3 },
      null,
    );

    resultSeIncompletoId = await inserirResultado(
      { conscienciosidade: 0.2, extroversao: 0.2, amabilidade: 0.2, estabilidade: 0.2, abertura: 0.2 },
      { conscienciosidade: 0.3, extroversao: 0.3, amabilidade: 0.3, estabilidade: 0.3 },
      0.5,
    );

    // Único fixture com calibração NÃO-provisória. Sem ele, todo resultado da
    // suíte nasce 'literatura_v1' e o discriminador de provisoriedade fica
    // meio coberto: trocá-lo por `true` fixo passava nos 16 casos.
    resultCalibradoId = await inserirResultado(
      { conscienciosidade: 0.4, extroversao: 0.1, amabilidade: 0.2, estabilidade: 0.3, abertura: 0.1 },
      { conscienciosidade: 0.28, extroversao: 0.29, amabilidade: 0.3, estabilidade: 0.31, abertura: 0.32 },
      0.8,
      undefined,
      'calib_2027_01',
    );

    for (const id of [
      resultId,
      resultExtremosId,
      resultSemConfiancaId,
      resultSeIncompletoId,
      resultCalibradoId,
    ]) {
      await conceder(id, tenantComGrant);
    }
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM result_grant WHERE tenant_id IN ($1,$2)', [tenantComGrant, tenantSemGrant]);
    await adminPool.query('DELETE FROM assessment_result WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM consent WHERE id = $1', [consentId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1,$2)', [tenantComGrant, tenantSemGrant]);
    await adminPool.end();
    await appPool.end();
  });

  it('gera relatório com uma seção por dimensão e o rodapé obrigatório', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);

    expect(relatorio.secoes).toHaveLength(5);
    expect(relatorio.rodape).toBe(RODAPE_OBRIGATORIO);
    expect(relatorio.rodape).toMatch(/não constitui avaliação psicológica/i);
  });

  // A escolha da faixa narrativa é a ÚNICA lógica substantiva do serviço.
  // Sem estas asserções, inverter alto/baixo no corte -- ou publicar o erro
  // padrão no lugar do escore -- passaria verde e chegaria ao cliente.
  it('amarra faixa narrativa, estimativa de theta e erro padrão de cada dimensão ao theta gravado', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);

    // theta 0.8 > 0.5 -> faixa ALTA
    expect(secao(relatorio, 'conscienciosidade').texto).toBe(ROTULOS.conscienciosidade.alto);
    expect(secao(relatorio, 'conscienciosidade').titulo).toBe(ROTULOS.conscienciosidade.titulo);
    expect(secao(relatorio, 'conscienciosidade').estimativaTheta).toBe(0.8);
    expect(secao(relatorio, 'conscienciosidade').erroPadrao).toBe(0.35);

    // theta -0.3 -> faixa MÉDIA (não é baixa: -0.3 não é < -0.5)
    expect(secao(relatorio, 'extroversao').texto).toBe(ROTULOS.extroversao.medio);
    expect(secao(relatorio, 'extroversao').estimativaTheta).toBe(-0.3);
    expect(secao(relatorio, 'extroversao').erroPadrao).toBe(0.4);

    expect(secao(relatorio, 'amabilidade').texto).toBe(ROTULOS.amabilidade.medio);
    expect(secao(relatorio, 'amabilidade').estimativaTheta).toBe(0.1);

    expect(secao(relatorio, 'abertura').texto).toBe(ROTULOS.abertura.medio);
    expect(secao(relatorio, 'abertura').estimativaTheta).toBe(-0.2);

    expect(relatorio.indiceConfiancaProtocolo).toBe(0.62);
  });

  // "Escore bruto" já tem significado fechado e testado neste repositório:
  // é a CONTAGEM de endosso chaveada (mfc-scoring.ts, e o teste
  // "escore_bruto gravado é a contagem observada, não uma cópia de theta"
  // em assessment.service.spec.ts). Publicar theta sob esse nome faria o
  // mesmo resultado exibir -0.8 no relatório e -8 na exportação auditada,
  // dois números sob um nome só, no payload que chega ao recrutador e ao
  // candidato.
  it('publica a estimativa de theta -- não a contagem de escore bruto, e não sob esse nome', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);

    expect(secao(relatorio, 'conscienciosidade').estimativaTheta).toBe(0.8);

    const linha = await adminPool.query<{
      theta: Record<string, number>;
      escore_bruto: Record<string, number>;
    }>('SELECT theta, escore_bruto FROM assessment_result WHERE id = $1', [resultId]);
    expect(linha.rows[0].theta.conscienciosidade).toBe(0.8);
    expect(linha.rows[0].escore_bruto.conscienciosidade).toBe(8);
    expect(linha.rows[0].escore_bruto).not.toEqual(linha.rows[0].theta);

    const serializado = JSON.stringify(relatorio).toLowerCase();
    expect(serializado).not.toContain('escorebruto');
    expect(serializado).not.toContain('escore_bruto');
  });

  it('cobre a faixa baixa e as duas bordas do corte (±0.5 fica na faixa média)', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultExtremosId);

    // theta -0.8 < -0.5 -> faixa BAIXA
    expect(secao(relatorio, 'conscienciosidade').texto).toBe(ROTULOS.conscienciosidade.baixo);
    expect(secao(relatorio, 'conscienciosidade').estimativaTheta).toBe(-0.8);
    expect(secao(relatorio, 'conscienciosidade').erroPadrao).toBe(0.3);

    // theta 0.51 -> ALTA; 0.5 exato -> MÉDIA (o corte é estrito, não >=)
    expect(secao(relatorio, 'extroversao').texto).toBe(ROTULOS.extroversao.alto);
    expect(secao(relatorio, 'estabilidade').texto).toBe(ROTULOS.estabilidade.medio);

    // theta -0.51 -> BAIXA; -0.5 exato -> MÉDIA
    expect(secao(relatorio, 'abertura').texto).toBe(ROTULOS.abertura.baixo);
    expect(secao(relatorio, 'amabilidade').texto).toBe(ROTULOS.amabilidade.medio);
  });

  it('RECUSA publicar quando o texto gerado contém termo clínico', async () => {
    // Este é o gate regulatório da Res. CFP 31/2022 -- o entregável de
    // cabeçalho da task -- e não tinha NENHUM teste: apagar o bloco inteiro
    // (corpo + classificarTermosClinicos + throw) de report.service.ts
    // deixava os 16 casos verdes.
    //
    // O teste vizinho ('o corpo não contém termo clínico') NÃO cobre isto:
    // ele re-roda o linter sobre o corpo aqui no processo de teste, então
    // prende só o conteúdo das constantes ROTULOS -- que são limpas por
    // construção. A verificação em RUNTIME podia ser removida inteira e ele
    // continuava passando. Ou seja: o controle que decide se um relatório
    // publica ou não estava sustentado por um comentário.
    //
    // ROTULOS é exportado e mutável, então dá para sujar um rótulo de
    // propósito, exercitar o caminho de verdade e restaurar no finally.
    const original = ROTULOS.abertura.medio;
    try {
      ROTULOS.abertura.medio = 'Sugere transtorno de adaptação a mudanças.';

      await expect(
        gerarComo(tenantComGrant, resultId),
      ).rejects.toThrow(/vocabulário clínico/i);
    } finally {
      ROTULOS.abertura.medio = original;
    }

    // O mesmo relatório volta a publicar depois de restaurado -- senão este
    // teste poderia estar passando por qualquer outra falha.
    const relatorio = await gerarComo(tenantComGrant, resultId);
    expect(relatorio.secoes.length).toBeGreaterThan(0);
  });

  it('calibração real desliga o aviso de provisoriedade', async () => {
    // A direção perigosa (perder o aviso) já era coberta; esta é a outra:
    // com `calibracaoProvisoria = true` fixo os 16 casos passavam, e no dia
    // em que a calibração real subir o relatório seguiria avisando recrutador
    // de que o escore é provisório para sempre.
    const relatorio = await gerarComo(tenantComGrant, resultCalibradoId);

    expect(relatorio.calibracaoProvisoria).toBe(false);
    expect(relatorio.avisoCalibracao).toBeNull();
  });

  it('o corpo do relatório não contém nenhum termo clínico', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);

    const corpo = relatorio.secoes.map((s) => `${s.titulo} ${s.texto}`).join(' ');
    expect(classificarTermosClinicos(corpo)).toEqual([]);
  });

  it('NÃO expõe percentil em nenhum campo do payload', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);
    const serializado = JSON.stringify(relatorio).toLowerCase();

    expect(serializado).not.toContain('percentil');
    expect(serializado).not.toContain('percentile');
  });

  it('marca explicitamente que a calibração ainda é provisória', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultId);
    expect(relatorio.calibracaoProvisoria).toBe(true);
    expect(relatorio.avisoCalibracao).toMatch(/provis/i);
  });

  it('confiança de protocolo nunca calculada sai como null, não como 0.00', async () => {
    const relatorio = await gerarComo(tenantComGrant, resultSemConfiancaId);
    expect(relatorio.indiceConfiancaProtocolo).toBeNull();
  });

  it('lança em vez de publicar o prior quando falta o erro padrão de uma dimensão', async () => {
    await expect(gerarComo(tenantComGrant, resultSeIncompletoId)).rejects.toThrow(/erro padrão/i);
  });

  it('lança se o resultado não existir, em vez de gerar relatório vazio', async () => {
    await expect(
      gerarComo(tenantComGrant, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/não encontrado/i);
    await expect(
      gerarComo(tenantComGrant, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('tenant SEM result_grant não recebe o relatório de um resultado existente', async () => {
    await expect(gerarComo(tenantSemGrant, resultId)).rejects.toThrow(/não encontrado/i);
  });

  it('grant revogado não dá acesso', async () => {
    const grantId = await conceder(resultId, tenantSemGrant, { revoked: true });
    try {
      await expect(gerarComo(tenantSemGrant, resultId)).rejects.toThrow(/não encontrado/i);
    } finally {
      await adminPool.query('DELETE FROM result_grant WHERE id = $1', [grantId]);
    }
  });

  it('grant expirado não dá acesso', async () => {
    const grantId = await conceder(resultId, tenantSemGrant, { expirado: true });
    try {
      await expect(gerarComo(tenantSemGrant, resultId)).rejects.toThrow(/não encontrado/i);
    } finally {
      await adminPool.query('DELETE FROM result_grant WHERE id = $1', [grantId]);
    }
  });

  it('sem app.tenant_id nenhum grant vale — a leitura falha FECHADA', async () => {
    // Conexão crua, fora de TenantContext: a GUC não está setada, então o
    // NULLIF resolve para NULL e o EXISTS nunca casa.
    const client = await appPool.connect();
    try {
      await expect(new ReportService().gerar(client, resultId)).rejects.toThrow(/não encontrado/i);
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------------
  // Os testes de autorização acima todos passam pelo pool `app_runtime`,
  // onde a RLS de `result_grant` já barra sozinha -- então eles ficariam
  // verdes mesmo se o predicado de tenant fosse apagado da query do
  // ReportService. Os dois abaixo rodam sobre a conexão de admin, que é
  // rolsuper/rolbypassrls: ali as policies de `result_grant` NÃO rodam e o
  // predicado escrito na query é o ÚNICO controle entre o chamador e o
  // grant de outro tenant. É exatamente o caminho de conexões de
  // admin/ops/migração e o caminho que o gate consolidado da fase usa.
  // ------------------------------------------------------------------

  it('conexão que ignora RLS, sem app.tenant_id, não recebe relatório', async () => {
    const client = await adminPool.connect();
    try {
      const papel = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      // Premissa do teste: se este papel deixar de ignorar RLS, o teste
      // deixa de exercitar o caminho que ele existe para cobrir -- e falha
      // aqui, alto e claro, em vez de virar um teste vazio e silencioso.
      expect(papel.rows[0].rolsuper || papel.rows[0].rolbypassrls).toBe(true);

      // E a RLS está mesmo desligada nesta conexão: o grant do outro tenant
      // é visível a olho nu.
      const grants = await client.query('SELECT 1 FROM result_grant WHERE assessment_result_id = $1', [resultId]);
      expect(grants.rows.length).toBeGreaterThan(0);

      await expect(new ReportService().gerar(client, resultId)).rejects.toThrow(/não encontrado/i);
    } finally {
      client.release();
    }
  });

  it('conexão que ignora RLS não enxerga o grant de OUTRO tenant', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantSemGrant]);
      await expect(new ReportService().gerar(client, resultId)).rejects.toThrow(/não encontrado/i);

      // Controle positivo: no MESMO caminho sem RLS, o tenant que de fato
      // tem grant recebe. Sem isto, o teste acima passaria por qualquer
      // motivo (query quebrada, fixture ausente).
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantComGrant]);
      const relatorio = await new ReportService().gerar(client, resultId);
      expect(relatorio.secoes).toHaveLength(5);
    } finally {
      // ROLLBACK no finally: uma asserção que falha no meio não pode
      // devolver ao pool uma conexão com transação aberta (e com a GUC de
      // tenant ainda setada) para o próximo teste herdar.
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
