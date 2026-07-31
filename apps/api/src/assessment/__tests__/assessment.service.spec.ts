import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { OutboxService } from '../../outbox/outbox.service';
import { AssessmentService } from '../assessment.service';

const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';

const DIMENSOES = [
  'abertura',
  'amabilidade',
  'conscienciosidade',
  'estabilidade',
  'extroversao',
];

interface ItemDoBloco {
  itemId: string;
  dominio: string;
  valencia: 'positivo' | 'negativo';
}

interface BlocoDoInstrumento {
  blockId: string;
  itemIds: string[];
  itens: ItemDoBloco[];
}

describe('AssessmentService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  let tenantId: string;
  let applicationId: string;
  let personId: string;
  // Pessoa REAL, existente, mas que não é titular da candidatura acima --
  // é exatamente o caso que a conferência de titularidade tem de barrar.
  let personOutroId: string;

  // Segundo tenant, usado só para provar que a escrita no silo global
  // (item_response) não atravessa a fronteira de tenant.
  let tenantOutroId: string;
  let personOutroTenantId: string;
  let assessmentDoOutroTenantId: string;

  let encryption: EnvelopeEncryptionService;

  const service = () => new AssessmentService(new OutboxService());

  beforeAll(async () => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');
    encryption = new EnvelopeEncryptionService();

    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Empresa Assess Svc','00000000000051','test-tenant-00000000000051') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1,'empresa','Matriz','matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1,$2,'Req Svc','aprovada',now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1,$2,'Vaga Svc','vaga-assess-svc','{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-svc','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Svc','assesssvc@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-svc-outro','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Svc Outro','assesssvcoutro@example.com')
       RETURNING id`,
    );
    personOutroId = outro.rows[0].id;
    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, job.rows[0].id, personId],
    );
    applicationId = app.rows[0].id;

    // --- segundo tenant, cadeia mínima até um assessment já iniciado ---
    const t2 = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Empresa Assess Svc Vizinha','00000000000054','test-tenant-00000000000054') RETURNING id`,
    );
    tenantOutroId = t2.rows[0].id;
    const org2 = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1,'empresa','Matriz','matriz') RETURNING id`,
      [tenantOutroId],
    );
    const req2 = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1,$2,'Req Svc Vizinha','aprovada',now()) RETURNING id`,
      [tenantOutroId, org2.rows[0].id],
    );
    const job2 = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1,$2,'Vaga Svc Vizinha','vaga-assess-svc-vizinha','{}') RETURNING id`,
      [tenantOutroId, req2.rows[0].id],
    );
    const person2 = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-svc-vizinha','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Svc Vizinha','assesssvcvizinha@example.com')
       RETURNING id`,
    );
    personOutroTenantId = person2.rows[0].id;
    const app2 = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantOutroId, job2.rows[0].id, personOutroTenantId],
    );
    const aa2 = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id, status, iniciado_em)
       VALUES ($1,$2,$3,$4,'iniciado',now()) RETURNING id`,
      [tenantOutroId, app2.rows[0].id, personOutroTenantId, VERSION_ID],
    );
    assessmentDoOutroTenantId = aa2.rows[0].id;
  });

  afterAll(async () => {
    try {
      for (const t of [tenantId, tenantOutroId]) {
        await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [t]);
        await adminPool.query(
          'DELETE FROM item_response WHERE assessment_application_id IN (SELECT id FROM assessment_application WHERE tenant_id = $1)',
          [t],
        );
        await adminPool.query('DELETE FROM assessment_application WHERE tenant_id = $1', [t]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [t]);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [t]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [t]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [t]);
      }
      for (const p of [personId, personOutroId, personOutroTenantId]) {
        await adminPool.query('DELETE FROM assessment_result WHERE person_id = $1', [p]);
        await adminPool.query('DELETE FROM person WHERE id = $1', [p]);
      }
      for (const t of [tenantId, tenantOutroId]) {
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [t]);
      }
    } finally {
      await adminPool.end();
      await appPool.end();
    }
  });

  async function blocosDoInstrumento(): Promise<BlocoDoInstrumento[]> {
    const { rows } = await adminPool.query<{
      block_id: string;
      item_ids: string[];
      dominios: string[];
      valencias: ('positivo' | 'negativo')[];
    }>(
      `SELECT b.id AS block_id,
              array_agg(bi.item_id ORDER BY bi.posicao)      AS item_ids,
              array_agg(i.dominio ORDER BY bi.posicao)       AS dominios,
              array_agg(i.chave_valencia ORDER BY bi.posicao) AS valencias
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
         JOIN item i ON i.id = bi.item_id
        WHERE b.instrument_version_id = $1
        GROUP BY b.id ORDER BY min(b.ordem)`,
      [VERSION_ID],
    );
    return rows.map((r) => ({
      blockId: r.block_id,
      itemIds: r.item_ids,
      itens: r.item_ids.map((itemId, i) => ({
        itemId,
        dominio: r.dominios[i],
        valencia: r.valencias[i],
      })),
    }));
  }

  /**
   * Escolhe MAIS/MENOS pela VALÊNCIA do item, nunca pela posição dele no
   * bloco. Os 20 blocos do seed hoje trazem o item positivo em primeiro, e
   * um teste que escreve `maisId: itemIds[0]` está de fato dependendo dessa
   * coincidência de ordenação -- se o seed reordenar, o teste continua verde
   * medindo outra coisa.
   */
  function endossar(bloco: BlocoDoInstrumento, polo: 'positivo' | 'negativo') {
    const mais = bloco.itens.find((i) => i.valencia === polo);
    const menos = bloco.itens.find((i) => i.itemId !== mais?.itemId);
    if (!mais || !menos) throw new Error(`Bloco ${bloco.blockId} sem par de valência oposta`);
    return { maisId: mais.itemId, menosId: menos.itemId };
  }

  async function responderTudo(
    svc: AssessmentService,
    ctx: TenantContext,
    id: string,
    polo: 'positivo' | 'negativo',
  ): Promise<void> {
    for (const bloco of await blocosDoInstrumento()) {
      const { maisId, menosId } = endossar(bloco, polo);
      await ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      );
    }
  }

  it('convidar grava assessment.invited e nasce em status convidado', async () => {
    const ctx = new TenantContext(appPool);
    const { id } = await ctx.run(tenantId, (client) =>
      service().convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );

    const row = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(row.rows[0].status).toBe('convidado');

    const ev = await adminPool.query(
      `SELECT 1 FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'assessment.invited'`,
      [id],
    );
    expect(ev.rows).toHaveLength(1);
  });

  it('convidar recusa person_id que não é o titular da candidatura', async () => {
    // A FK de assessment_application.person_id aponta para a tabela GLOBAL
    // person e não tem nenhuma relação com a candidatura referenciada -- o
    // banco aceita a troca sem reclamar. Se o serviço também aceitar, o
    // resultado comportamental fica atribuído à pessoa errada, numa tabela
    // compartilhada com outros tenants via result_grant.
    const ctx = new TenantContext(appPool);
    await expect(
      ctx.run(tenantId, (client) =>
        service().convidar(client, {
          tenantId,
          applicationId,
          personId: personOutroId,
          instrumentVersionId: VERSION_ID,
        }),
      ),
    ).rejects.toThrow(/não é o titular/i);

    const vazou = await adminPool.query(
      'SELECT 1 FROM assessment_application WHERE person_id = $1',
      [personOutroId],
    );
    expect(vazou.rows).toHaveLength(0);
  });

  it('fluxo completo: endosso do polo alto produz theta positivo nas 5 dimensões', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    await responderTudo(svc, ctx, id, 'positivo');

    const inicio = Date.now();
    const resultado = await ctx.run(tenantId, (client) => svc.concluir(client, encryption, id));
    const decorrido = Date.now() - inicio;

    // SLO do roadmap: theta/se disponíveis em < 2s após a última resposta.
    expect(decorrido).toBeLessThan(2000);

    expect(Object.keys(resultado.theta).sort()).toEqual(DIMENSOES);

    for (const dimensao of DIMENSOES) {
      // DIRECIONAL, não só finito. Quem aponta sempre o item de chave
      // POSITIVA como o mais característico e o de chave NEGATIVA como o
      // menos está endossando o polo alto do traço em todos os 4 blocos da
      // dimensão -- θ tem de subir. Asserção só de `Number.isFinite` passa
      // com estimador quebrado: apagar a inversão de sinal de `aEfetivo`
      // (o bug de inversão silenciosa de escore que esta fase existe para
      // impedir) achata a verossimilhança e joga θ para perto de 0 sem que
      // nada fique NaN. Medido: θ ≈ 1,32-1,37 correto, ≈ 0,3 com o sinal
      // apagado -- o limiar de 0,8 fica entre os dois com folga dos dois
      // lados.
      expect(resultado.theta[dimensao]).toBeGreaterThan(0.8);
      // SE tem de ser MENOR que o desvio do prior (≈ 0,9996 na grade). Uma
      // dimensão sem evidência devolve exatamente o prior, e é assim que se
      // distingue "medido" de "não medido". Medido: ≈ 0,61.
      expect(resultado.seTheta[dimensao]).toBeGreaterThan(0);
      expect(resultado.seTheta[dimensao]).toBeLessThan(0.85);
      // Escore bruto é CONTAGEM, não θ: 4 blocos por dimensão, cada bloco
      // com os dois lados empurrando para o polo alto = +8.
      expect(resultado.escoreBruto[dimensao]).toBe(8);
    }

    const status = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(status.rows[0].status).toBe('concluido');

    const ev = await adminPool.query(
      `SELECT event_type FROM outbox_event WHERE aggregate_id = $1 ORDER BY sequence`,
      [id],
    );
    expect(ev.rows.map((r) => r.event_type)).toEqual([
      'assessment.invited',
      'assessment.started',
      'assessment.completed',
    ]);
  });

  it('escore_bruto gravado é a contagem observada, não uma cópia de theta', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    // Padrão ESPELHADO: aponta sempre o item de chave negativa como o mais
    // característico. θ tem de descer -- e descer é o que prova que a
    // valência entra na conta.
    await responderTudo(svc, ctx, id, 'negativo');

    const resultado = await ctx.run(tenantId, (client) => svc.concluir(client, encryption, id));

    for (const dimensao of DIMENSOES) {
      expect(resultado.theta[dimensao]).toBeLessThan(-0.8);
      expect(resultado.escoreBruto[dimensao]).toBe(-8);
    }

    const linha = await adminPool.query<{
      theta: Record<string, number>;
      escore_bruto: Record<string, number>;
      calibracao_versao: string;
    }>(
      'SELECT theta, escore_bruto, calibracao_versao FROM assessment_result WHERE id = $1',
      [resultado.assessmentResultId],
    );
    // escore_bruto é a quantidade OBSERVADA contra a qual uma calibração ou
    // auditoria compara o θ estimado. Gravar θ nas duas colunas destrói
    // exatamente essa checagem.
    expect(linha.rows[0].escore_bruto).not.toEqual(linha.rows[0].theta);
    expect(linha.rows[0].escore_bruto.abertura).toBe(-8);

    // A procedência gravada tem de vir das linhas de parâmetro realmente
    // usadas, não de um literal no código.
    const versaoNoBanco = await adminPool.query<{ calibracao_versao: string }>(
      `SELECT DISTINCT ipv.calibracao_versao
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
         JOIN item_parameter_version ipv ON ipv.item_id = bi.item_id
        WHERE b.instrument_version_id = $1`,
      [VERSION_ID],
    );
    expect(versaoNoBanco.rows).toHaveLength(1);
    expect(linha.rows[0].calibracao_versao).toBe(versaoNoBanco.rows[0].calibracao_versao);
  });

  it('a resposta bruta fica criptografada — o payload em claro não aparece na coluna', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');
    await ctx.run(tenantId, (client) =>
      svc.responderBloco(client, encryption, {
        assessmentApplicationId: id,
        blockId: bloco.blockId,
        itemIds: bloco.itemIds,
        maisId,
        menosId,
      }),
    );

    const row = await adminPool.query<{ resposta_criptografada: unknown }>(
      'SELECT resposta_criptografada FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    const bruto = JSON.stringify(row.rows[0].resposta_criptografada);
    // O id do item escolhido não pode aparecer em claro no payload gravado.
    expect(bruto).not.toContain(maisId);
    expect(bruto).toContain('ciphertext');
  });

  it('rejeita responder o mesmo bloco duas vezes', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');

    const responder = () =>
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      );

    await responder();
    await expect(responder()).rejects.toMatchObject({ code: '23505' });
  });

  it('rejeita bloco em que mais e menos são o mesmo item', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    const [bloco] = await blocosDoInstrumento();

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId: bloco.itemIds[0],
          menosId: bloco.itemIds[0],
        }),
      ),
    ).rejects.toThrow(/mesmo item/i);
  });

  it('rejeita itemIds forjados: par de outro bloco enviado no lugar do bloco pedido', async () => {
    // O ataque concreto: mandar, no slot de um bloco de ABERTURA, o par de
    // itens de CONSCIENCIOSIDADE e vencer a comparação -- escorando uma
    // dimensão que o bloco não mede. `decomporBlocoEmPares` é pura e não
    // enxerga isso; só a conferência contra `block_item` enxerga.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const blocos = await blocosDoInstrumento();
    const alvo = blocos.find((b) => b.itens[0].dominio === 'abertura')!;
    const doador = blocos.find((b) => b.itens[0].dominio === 'conscienciosidade')!;
    expect(alvo.blockId).not.toBe(doador.blockId);

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: alvo.blockId,
          itemIds: doador.itemIds,
          maisId: doador.itemIds[0],
          menosId: doador.itemIds[1],
        }),
      ),
    ).rejects.toThrow(/não corresponde à composição do bloco/i);

    const gravou = await adminPool.query(
      'SELECT 1 FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    expect(gravou.rows).toHaveLength(0);
  });

  it('rejeita itemIds com item repetido', async () => {
    // Repetição duplica o par de comparação e conta a mesma evidência duas
    // vezes.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    const [bloco] = await blocosDoInstrumento();

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: [...bloco.itemIds, bloco.itemIds[0]],
          maisId: bloco.itemIds[0],
          menosId: bloco.itemIds[1],
        }),
      ),
    ).rejects.toThrow(/repetido/i);
  });

  it('rejeita resposta antes de iniciar e depois de expirar', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');

    const responder = () =>
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      );

    // status 'convidado' -- ainda não começou.
    await expect(responder()).rejects.toThrow(/não aceita resposta/i);

    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    await adminPool.query(`UPDATE assessment_application SET status = 'expirado' WHERE id = $1`, [id]);

    // Resposta depois do fim do prazo entraria na amostra de calibração
    // vinda de um protocolo cujas condições de aplicação não valem mais.
    await expect(responder()).rejects.toThrow(/não aceita resposta/i);

    const gravou = await adminPool.query(
      'SELECT 1 FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    expect(gravou.rows).toHaveLength(0);
  });

  it('não grava no silo global resposta contra assessment de outro tenant', async () => {
    // item_response não tem tenant_id, não tem RLS e tem INSERT liberado
    // para app_runtime: escrever nele é, por construção, caminho sem
    // isolamento. A leitura de assessment_application em responderBloco é o
    // que devolve o isolamento -- a linha do outro tenant não aparece sob a
    // RLS e a escrita morre antes de tocar o silo.
    const ctx = new TenantContext(appPool);
    const svc = service();
    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: assessmentDoOutroTenantId,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      ),
    ).rejects.toThrow(/não encontrado/i);

    const envenenou = await adminPool.query(
      'SELECT 1 FROM item_response WHERE assessment_application_id = $1',
      [assessmentDoOutroTenantId],
    );
    expect(envenenou.rows).toHaveLength(0);
  });

  it('recusa concluir protocolo incompleto em vez de escorar o que faltou como média', async () => {
    // Sem esta guarda o estimador devolve o prior para a dimensão sem
    // evidência (θ ≈ 0, SE ≈ 0,9996) e a linha gravada fica indistinguível
    // da de um respondente genuinamente médio -- nada em assessment_result
    // registra quantos blocos foram respondidos.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');
    await ctx.run(tenantId, (client) =>
      svc.responderBloco(client, encryption, {
        assessmentApplicationId: id,
        blockId: bloco.blockId,
        itemIds: bloco.itemIds,
        maisId,
        menosId,
      }),
    );

    const antes = await adminPool.query<{ n: string }>(
      'SELECT count(*) AS n FROM assessment_result WHERE person_id = $1',
      [personId],
    );

    await expect(
      ctx.run(tenantId, (client) => svc.concluir(client, encryption, id)),
    ).rejects.toThrow(/incompleto: 1 de 20 blocos/i);

    const depois = await adminPool.query<{ n: string }>(
      'SELECT count(*) AS n FROM assessment_result WHERE person_id = $1',
      [personId],
    );
    // Nenhum resultado novo pode ter nascido desta tentativa.
    expect(depois.rows[0].n).toBe(antes.rows[0].n);

    const status = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(status.rows[0].status).toBe('iniciado');
  });

  it('recusa iniciar depois do prazo do convite (expira_em), sem depender do status', async () => {
    // Nada no repositório escreve o status 'expirado' -- não existe job de
    // expiração nesta fase. Quem só olha `status` deixa o prazo sem dono: o
    // convite vencido continua 'convidado' e seria aceito. A condição que
    // expirou é a do relógio.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, {
        tenantId,
        applicationId,
        personId,
        instrumentVersionId: VERSION_ID,
        expiraEm: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }),
    );

    const gravado = await adminPool.query<{ status: string; expira_em: Date }>(
      'SELECT status, expira_em FROM assessment_application WHERE id = $1',
      [id],
    );
    // O prazo está no passado E o status continua 'convidado' -- é
    // exatamente a combinação que a guarda de status não enxerga.
    expect(gravado.rows[0].status).toBe('convidado');
    expect(gravado.rows[0].expira_em.getTime()).toBeLessThan(Date.now());

    await expect(ctx.run(tenantId, (client) => svc.iniciar(client, id))).rejects.toThrow(
      /prazo expirado/i,
    );

    const depois = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(depois.rows[0].status).toBe('convidado');
  });

  it('recusa resposta depois do prazo mesmo com status iniciado, e não toca o silo', async () => {
    // O caso de produção: candidato começou dentro do prazo, sumiu, e volta
    // depois do vencimento. Sem checagem de relógio a resposta é aceita,
    // escorada e o resultado compartilhado com outros tenants via
    // result_grant -- e ainda entra na amostra de calibração vinda de um
    // protocolo cujas condições de aplicação não valem mais.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, {
        tenantId,
        applicationId,
        personId,
        instrumentVersionId: VERSION_ID,
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    // O prazo vence com o protocolo já em andamento.
    await adminPool.query(
      `UPDATE assessment_application SET expira_em = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    const antes = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(antes.rows[0].status).toBe('iniciado');

    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      ),
    ).rejects.toThrow(/prazo expirado/i);

    const gravou = await adminPool.query(
      'SELECT 1 FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    expect(gravou.rows).toHaveLength(0);
  });

  it('responderBloco trava a linha do assessment: não grava resposta órfã contra status obsoleto', async () => {
    // Regressão de concorrência. Sob READ COMMITTED (o que TenantContext.run
    // usa) um SELECT sem FOR UPDATE não trava nada, então `responderBloco`
    // enxerga 'iniciado' mesmo com uma transação concorrente já a caminho de
    // concluir o protocolo -- e a resposta commita pendurada num assessment
    // 'concluido', dentro do silo GLOBAL, sem entrar em nenhum θ e entrando
    // na amostra de calibração.
    //
    // Aqui a transação concorrente é simulada de forma determinística: um
    // client segura o lock da linha e só então a conclui. Sem o FOR UPDATE em
    // `responderBloco`, a leitura de cabeçalho passa direto pelo lock, lê o
    // status velho e o INSERT no silo acontece.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const [bloco] = await blocosDoInstrumento();
    const { maisId, menosId } = endossar(bloco, 'positivo');

    const bloqueador = await adminPool.connect();
    let pendente: Promise<unknown> | undefined;
    try {
      await bloqueador.query('BEGIN');
      await bloqueador.query('SELECT id FROM assessment_application WHERE id = $1 FOR UPDATE', [id]);

      pendente = ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId,
          menosId,
        }),
      );
      // Anexa um handler já agora para que uma rejeição futura nunca conte
      // como unhandled rejection enquanto esperamos.
      const observado = pendente.then(
        () => 'resolveu',
        () => 'rejeitou',
      );

      const AINDA_ESPERANDO = 'ainda-esperando';
      const corrida = await Promise.race([
        observado,
        new Promise((r) => setTimeout(() => r(AINDA_ESPERANDO), 750)),
      ]);
      // Esta asserção prova que a transação está BLOQUEADA -- e só isso.
      // Não prova que é a leitura de cabeçalho que pede o lock, embora seja
      // tentador ler assim. Sem o FOR UPDATE a transação esperaria no mesmo
      // ponto do relógio por outro motivo: o INSERT em item_response pega
      // FOR KEY SHARE na linha pai de assessment_application por causa da FK,
      // e FOR KEY SHARE conflita com o FOR UPDATE que o bloqueador segura.
      // Verificado: contra o serviço pré-correção este expect passa igual, e
      // a falha aparece só na asserção final.
      //
      // Quem carrega a prova do lock é a asserção do fim do teste: sem
      // FOR UPDATE a leitura de cabeçalho enxerga o status ANTIGO, o INSERT
      // destrava depois do COMMIT do bloqueador e a resposta é gravada órfã
      // contra um status já obsoleto -- em vez de rejeitada.
      expect(corrida).toBe(AINDA_ESPERANDO);

      await bloqueador.query(
        `UPDATE assessment_application SET status = 'concluido', concluido_em = now() WHERE id = $1`,
        [id],
      );
      await bloqueador.query('COMMIT');
    } finally {
      try {
        // No-op depois do COMMIT. Existe para o caso de uma asserção falhar
        // no meio: sem isto o client voltaria ao pool com transação aberta,
        // ainda segurando o lock, e travaria os testes seguintes.
        await bloqueador.query('ROLLBACK');
      } catch {
        // ignorado de propósito
      }
      bloqueador.release();
    }

    // Liberado o lock, a leitura relê a linha JÁ atualizada (EvalPlanQual) e
    // cai na guarda de status em vez de escrever.
    await expect(pendente).rejects.toThrow(/não aceita resposta \(status atual: concluido\)/i);

    const orfa = await adminPool.query(
      'SELECT 1 FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    expect(orfa.rows).toHaveLength(0);
  }, 30000);

  it('concluir trava a linha do assessment: não escora duas vezes o mesmo protocolo', async () => {
    // Mesma classe de problema do lado da conclusão. Sem FOR UPDATE, dois
    // `concluir` concorrentes leem 'iniciado' e ambos escoram; hoje o segundo
    // só morre porque a UNIQUE (tenant_id, aggregate_id, sequence) do outbox
    // recusa o segundo 'assessment.completed' -- acidente do esquema de
    // eventos, não uma guarda deste serviço. Com o lock a recusa vem da
    // guarda de status, que é o que se quis escrever.
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    await responderTudo(svc, ctx, id, 'positivo');

    const antes = await adminPool.query<{ n: string }>(
      'SELECT count(*) AS n FROM assessment_result WHERE person_id = $1',
      [personId],
    );

    const bloqueador = await adminPool.connect();
    let pendente: Promise<unknown> | undefined;
    try {
      await bloqueador.query('BEGIN');
      await bloqueador.query('SELECT id FROM assessment_application WHERE id = $1 FOR UPDATE', [id]);

      pendente = ctx.run(tenantId, (client) => svc.concluir(client, encryption, id));
      const observado = pendente.then(
        () => 'resolveu',
        () => 'rejeitou',
      );

      const AINDA_ESPERANDO = 'ainda-esperando';
      const corrida = await Promise.race([
        observado,
        new Promise((r) => setTimeout(() => r(AINDA_ESPERANDO), 750)),
      ]);
      // Mesma leitura do teste de responderBloco acima: prova bloqueio, não
      // prova de onde vem o lock. Aqui o caminho pré-correção espera no
      // UPDATE final de assessment_application. A prova do FOR UPDATE está
      // na asserção do fim.
      expect(corrida).toBe(AINDA_ESPERANDO);

      await bloqueador.query(
        `UPDATE assessment_application SET status = 'concluido', concluido_em = now() WHERE id = $1`,
        [id],
      );
      await bloqueador.query('COMMIT');
    } finally {
      try {
        // No-op depois do COMMIT. Existe para o caso de uma asserção falhar
        // no meio: sem isto o client voltaria ao pool com transação aberta,
        // ainda segurando o lock, e travaria os testes seguintes.
        await bloqueador.query('ROLLBACK');
      } catch {
        // ignorado de propósito
      }
      bloqueador.release();
    }

    await expect(pendente).rejects.toThrow(/não pode ser concluído \(status atual: concluido\)/i);

    const depois = await adminPool.query<{ n: string }>(
      'SELECT count(*) AS n FROM assessment_result WHERE person_id = $1',
      [personId],
    );
    // Nenhum resultado nasceu da tentativa que perdeu a corrida.
    expect(depois.rows[0].n).toBe(antes.rows[0].n);

    const eventos = await adminPool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'assessment.completed'`,
      [id],
    );
    expect(eventos.rows).toHaveLength(0);
  }, 60000);
});
