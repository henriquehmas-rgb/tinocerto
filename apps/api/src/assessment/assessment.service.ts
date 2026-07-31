import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import {
  ComparacaoPar,
  ItemNoBloco,
  comparacoesRelevantes,
  decomporBlocoEmPares,
  escoreBrutoPorDimensao,
  estimarThetaEAP,
} from './scoring/mfc-scoring';

export interface ConvidarInput {
  tenantId: string;
  applicationId: string;
  personId: string;
  instrumentVersionId: string;
  nivelIntegridade?: number;
  multiplicadorTempo?: 1.0 | 1.5 | 2.0 | null;
  expiraEm?: Date;
}

export interface ResponderBlocoInput {
  assessmentApplicationId: string;
  blockId: string;
  itemIds: string[];
  maisId: string;
  menosId: string;
  duracaoMs?: number;
}

/**
 * Contrato INTERNO da escoragem -- calibração, testes e o próprio serviço
 * precisam de θ/SE aqui dentro. Ele NÃO é payload de resposta HTTP: a
 * única leitura de tenant autorizada sobre θ passa por `result_grant` e
 * sai por `ReportService.gerar`, com rodapé obrigatório e aviso de
 * calibração provisória. O corte está em `AssessmentController.concluir`,
 * e há teste de controller prendendo isso.
 */
export interface ResultadoEscoragem {
  assessmentResultId: string;
  theta: Record<string, number>;
  seTheta: Record<string, number>;
  escoreBruto: Record<string, number>;
  calibracaoVersao: string;
}

const DIMENSOES = ['conscienciosidade', 'extroversao', 'amabilidade', 'estabilidade', 'abertura'];

@Injectable()
export class AssessmentService {
  constructor(private readonly outbox: OutboxService) {}

  async convidar(client: PoolClient, input: ConvidarInput): Promise<{ id: string }> {
    // O titular do assessment é o titular da CANDIDATURA -- não um person_id
    // solto vindo do chamador. `assessment_application.person_id` tem FK
    // simples para a tabela GLOBAL person, sem nenhuma relação com a
    // candidatura referenciada; sem esta conferência o banco aceita, e aceita
    // em silêncio, um resultado comportamental atribuído a outra pessoa --
    // numa tabela (assessment_result) que é global e compartilhada com
    // outros tenants via result_grant. Erro assim não tem como ser desfeito
    // depois: o dado já foi lido por quem recebeu o grant.
    const candidatura = await client.query<{ person_id: string }>(
      `SELECT person_id FROM application WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.applicationId],
    );
    if (candidatura.rows.length === 0) {
      throw new NotFoundException(
        `Candidatura ${input.applicationId} não encontrada no tenant ${input.tenantId}`,
      );
    }
    const titular = candidatura.rows[0].person_id;
    if (titular !== input.personId) {
      throw new ForbiddenException(
        `Candidatura ${input.applicationId}: person_id ${input.personId} não é o titular da candidatura`,
      );
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO assessment_application
         (tenant_id, application_id, person_id, instrument_version_id, nivel_integridade, multiplicador_tempo, expira_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.tenantId,
        input.applicationId,
        // Valor do BANCO, não o do chamador -- já conferimos que são iguais,
        // e usar o do banco tira a última chance de divergência.
        titular,
        input.instrumentVersionId,
        input.nivelIntegridade ?? 0,
        input.multiplicadorTempo ?? null,
        input.expiraEm ?? null,
      ],
    );
    const id = result.rows[0].id;

    await this.emitir(client, input.tenantId, id, 'assessment.invited', {
      assessment_application_id: id,
      application_id: input.applicationId,
      person_id: titular,
    });

    return { id };
  }

  async iniciar(client: PoolClient, assessmentApplicationId: string): Promise<void> {
    // FOR UPDATE: ver o comentário do lock em `responderBloco`. Aqui o efeito
    // é serializar dois `iniciar` concorrentes -- sem o lock os dois leem
    // 'convidado' e só a UNIQUE (tenant_id, aggregate_id, sequence) do outbox
    // impede o segundo `assessment.started`, o que é sorte do esquema de
    // eventos, não uma garantia que este método tome.
    const atual = await client.query<{ tenant_id: string; status: string; expirado: boolean }>(
      `SELECT tenant_id, status,
              (expira_em IS NOT NULL AND expira_em <= now()) AS expirado
         FROM assessment_application WHERE id = $1
         FOR UPDATE`,
      [assessmentApplicationId],
    );
    if (atual.rows.length === 0) {
      throw new NotFoundException(`Assessment ${assessmentApplicationId} não encontrado`);
    }
    if (atual.rows[0].status !== 'convidado') {
      throw new ConflictException(
        `Assessment ${assessmentApplicationId} não pode ser iniciado (status atual: ${atual.rows[0].status})`,
      );
    }
    // Prazo do convite. Ver o comentário em `responderBloco` sobre por que a
    // checagem é de RELÓGIO e não de status.
    if (atual.rows[0].expirado) {
      throw new ConflictException(
        `Assessment ${assessmentApplicationId} não pode ser iniciado: prazo expirado (expira_em)`,
      );
    }

    await client.query(
      `UPDATE assessment_application SET status = 'iniciado', iniciado_em = now() WHERE id = $1`,
      [assessmentApplicationId],
    );

    await this.emitir(client, atual.rows[0].tenant_id, assessmentApplicationId, 'assessment.started', {
      assessment_application_id: assessmentApplicationId,
    });
  }

  async responderBloco(
    client: PoolClient,
    encryption: EnvelopeEncryptionService,
    input: ResponderBlocoInput,
  ): Promise<{ id: string }> {
    // 1) O assessment existe E é visível para o tenant desta conexão.
    //
    // item_response é SILO GLOBAL: sem tenant_id, sem RLS, com INSERT
    // liberado para app_runtime. Escrever direto nele é, por construção, um
    // caminho SEM isolamento -- uma conexão sob o GUC do tenant A conseguiria
    // gravar resposta contra o assessment do tenant B, envenenando o θ de um
    // candidato que ela nem enxerga e contaminando a amostra de calibração.
    // Esta leitura é o que traz o isolamento de volta: ela passa pela RLS de
    // assessment_application, então o assessment de outro tenant simplesmente
    // não aparece e a escrita morre aqui, antes de tocar o silo.
    //
    // FOR UPDATE, e não um SELECT solto: sob READ COMMITTED (o que
    // TenantContext.run usa -- o BEGIN é sem ISOLATION LEVEL) um SELECT
    // comum não trava a linha, então esta transação e um `concluir`
    // concorrente enxergam ambas 'iniciado' e as duas seguem em frente. Se a
    // resposta commitar depois de `concluir` já ter lido `item_response`, ela
    // fica no silo GLOBAL pendurada num assessment que virou 'concluido' e
    // nunca mais é escorada: entra na amostra de calibração sem entrar em
    // nenhum θ. O lock é o que torna a guarda de status abaixo serializável
    // -- com ele a segunda transação espera, relê a linha já atualizada
    // (EvalPlanQual) e cai na guarda em vez de escrever.
    const cabecalho = await client.query<{
      status: string;
      instrument_version_id: string;
      expirado: boolean;
    }>(
      `SELECT status, instrument_version_id,
              (expira_em IS NOT NULL AND expira_em <= now()) AS expirado
         FROM assessment_application WHERE id = $1
         FOR UPDATE`,
      [input.assessmentApplicationId],
    );
    if (cabecalho.rows.length === 0) {
      throw new NotFoundException(`Assessment ${input.assessmentApplicationId} não encontrado`);
    }

    // 2) Só responde quem está em andamento. Resposta gravada depois de
    // 'concluido' nunca seria escorada (o resultado já foi gravado e não há
    // recontagem), mas entraria na amostra de calibração vinda de um
    // protocolo cujas condições de aplicação não valem mais. Antes de
    // 'iniciado', mesma coisa.
    if (cabecalho.rows[0].status !== 'iniciado') {
      throw new ConflictException(
        `Assessment ${input.assessmentApplicationId} não aceita resposta (status atual: ${cabecalho.rows[0].status})`,
      );
    }

    // 2b) E o prazo do convite tem de estar de pé. A guarda de status acima
    // NÃO cobre isto: nada no repositório escreve o status 'expirado' (não há
    // job de expiração nesta fase), então um convite cujo `expira_em` passou
    // há um ano continua com status 'iniciado' e seria aceito. A condição de
    // aplicação que expirou é a do RELÓGIO, e é o relógio que precisa ser
    // consultado -- mesmo padrão de candidate-token.service.ts. Usamos now()
    // do BANCO (e não Date.now() do processo) porque é o mesmo relógio que
    // gravou `expira_em`: sem depender de sincronia entre app e banco.
    if (cabecalho.rows[0].expirado) {
      throw new ConflictException(
        `Assessment ${input.assessmentApplicationId} não aceita resposta: prazo expirado (expira_em)`,
      );
    }

    // 3) O bloco tem de ser DESTE instrumento, e os itens têm de ser
    // exatamente os que o bloco contém no banco.
    //
    // Sem esta conferência, `itemIds` é palavra do chamador: dá para mandar,
    // no lugar do bloco de abertura, o par de itens mais fortes de
    // conscienciosidade e vencer a comparação -- escorando uma dimensão que
    // o bloco não mede. `decomporBlocoEmPares` é função pura e não tem como
    // pegar isso: ela só confere mais != menos e pertinência ao array que
    // recebeu. Como o payload gravado é o que `concluir` descriptografa e
    // decompõe de novo, uma mentira aqui vira θ forjado lá.
    const composicao = await client.query<{ item_id: string }>(
      `SELECT bi.item_id
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
        WHERE b.id = $1 AND b.instrument_version_id = $2
        ORDER BY bi.posicao`,
      [input.blockId, cabecalho.rows[0].instrument_version_id],
    );
    if (composicao.rows.length === 0) {
      throw new BadRequestException(
        `Bloco ${input.blockId} não pertence ao instrumento deste assessment (${input.assessmentApplicationId})`,
      );
    }
    const itensDoBloco = composicao.rows.map((linha) => linha.item_id);

    const informados = new Set(input.itemIds);
    if (informados.size !== input.itemIds.length) {
      throw new BadRequestException(`Bloco ${input.blockId}: itemIds contém item repetido`);
    }
    if (
      informados.size !== itensDoBloco.length ||
      itensDoBloco.some((itemId) => !informados.has(itemId))
    ) {
      throw new BadRequestException(
        `Bloco ${input.blockId}: itemIds não corresponde à composição do bloco no instrumento`,
      );
    }

    // 4) Coerência da escolha (mais != menos, escolha dentro do bloco).
    // Roda sobre a composição VINDA DO BANCO, não sobre o array do chamador.
    decomporBlocoEmPares({
      blockId: input.blockId,
      itemIds: itensDoBloco,
      maisId: input.maisId,
      menosId: input.menosId,
    });

    // Persistimos a composição canônica do banco: o payload gravado é a
    // fonte da escoragem, e ele não pode depender do que o cliente digitou.
    const payload = JSON.stringify({
      itemIds: itensDoBloco,
      maisId: input.maisId,
      menosId: input.menosId,
    });
    const cifrado = encryption.encrypt(payload);

    const result = await client.query<{ id: string }>(
      `INSERT INTO item_response (assessment_application_id, block_id, resposta_criptografada, duracao_ms)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.assessmentApplicationId, input.blockId, JSON.stringify(cifrado), input.duracaoMs ?? null],
    );
    return { id: result.rows[0].id };
  }

  async concluir(
    client: PoolClient,
    encryption: EnvelopeEncryptionService,
    assessmentApplicationId: string,
  ): Promise<ResultadoEscoragem> {
    const cabecalho = await client.query<{
      tenant_id: string;
      person_id: string;
      application_id: string;
      instrument_version_id: string;
      status: string;
    }>(
      // FOR UPDATE pelo mesmo motivo de `responderBloco`: a guarda de status
      // logo abaixo só vale se ninguém puder mudar a linha entre a leitura e
      // o UPDATE final. Sem o lock, dois `concluir` concorrentes leem
      // 'iniciado' e ambos escoram; hoje o segundo morre na UNIQUE do outbox,
      // o que é acidente do esquema de eventos e não uma garantia deste
      // método. Todos os caminhos travam ESTA linha e só ela, sempre antes de
      // qualquer outra escrita -- ordem única, sem ciclo de deadlock.
      //
      // Note que `concluir` NÃO checa `expira_em`. O prazo é condição de
      // COLETA, e a coleta já foi barrada em `responderBloco`: aqui só se
      // escora evidência que entrou dentro do prazo. Recusar por relógio
      // neste ponto descartaria um protocolo íntegro só porque a chamada de
      // conclusão chegou segundos depois da última resposta.
      `SELECT tenant_id, person_id, application_id, instrument_version_id, status
         FROM assessment_application WHERE id = $1
         FOR UPDATE`,
      [assessmentApplicationId],
    );
    if (cabecalho.rows.length === 0) {
      throw new NotFoundException(`Assessment ${assessmentApplicationId} não encontrado`);
    }
    if (cabecalho.rows[0].status !== 'iniciado') {
      throw new ConflictException(
        `Assessment ${assessmentApplicationId} não pode ser concluído (status atual: ${cabecalho.rows[0].status})`,
      );
    }
    const {
      tenant_id: tenantId,
      person_id: personId,
      application_id: applicationId,
      instrument_version_id: versionId,
    } = cabecalho.rows[0];

    // Protocolo COMPLETO ou nada. No modo linear o instrumento tem
    // comprimento fixo, e escorar um protocolo pela metade produz um número
    // que parece escore e não é: uma dimensão sem comparação relevante
    // devolve exatamente o prior (θ ≈ 0, SE ≈ 1), indistinguível de um
    // respondente genuinamente médio, e nada na linha gravada registra
    // quantos blocos foram respondidos. Recusar é a única saída honesta.
    const totalBlocos = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM block WHERE instrument_version_id = $1`,
      [versionId],
    );
    const esperados = totalBlocos.rows[0].n;
    const respondidos = await client.query<{ n: number }>(
      `SELECT count(DISTINCT block_id)::int AS n
         FROM item_response WHERE assessment_application_id = $1`,
      [assessmentApplicationId],
    );
    if (esperados === 0) {
      throw new Error(`Instrumento ${versionId} não tem blocos -- nada a escorar`);
    }
    if (respondidos.rows[0].n !== esperados) {
      throw new ConflictException(
        `Assessment ${assessmentApplicationId} incompleto: ${respondidos.rows[0].n} de ${esperados} blocos respondidos`,
      );
    }

    // Catálogo de itens do instrumento com UMA versão de calibração só.
    //
    // `uq_ipv_item_calibracao` é UNIQUE (item_id, calibracao_versao): assim
    // que uma calibration_run acrescentar a segunda linha de parâmetro por
    // item, um JOIN sem critério devolve duas linhas por item e o catálogo
    // vira "a última que o Postgres devolveu ganha", sobre um resultado sem
    // ordem definida -- θ escorado contra uma mistura não determinística de
    // parâmetro vigente e superado. Aqui a versão é escolhida ANTES: entre as
    // que cobrem TODOS os itens do instrumento, prefere a já calibrada
    // (nenhum item provisório), depois a mais recente, com o nome da versão
    // como desempate final para a ordenação ser total.
    const catalogo = await client.query<{
      item_id: string;
      dominio: string;
      chave_valencia: 'positivo' | 'negativo';
      a: string;
      b: string;
      c: string;
      calibracao_versao: string;
    }>(
      `WITH itens_instrumento AS (
         SELECT DISTINCT i.id, i.dominio, i.chave_valencia
           FROM block b
           JOIN block_item bi ON bi.block_id = b.id
           JOIN item i ON i.id = bi.item_id
          WHERE b.instrument_version_id = $1
       ),
       versao_escolhida AS (
         SELECT ipv.calibracao_versao
           FROM item_parameter_version ipv
           JOIN itens_instrumento ii ON ii.id = ipv.item_id
          GROUP BY ipv.calibracao_versao
         HAVING count(*) = (SELECT count(*) FROM itens_instrumento)
          ORDER BY bool_or(ipv.provisorio) ASC,
                   max(ipv.criado_em) DESC,
                   ipv.calibracao_versao DESC
          LIMIT 1
       )
       SELECT ii.id AS item_id, ii.dominio, ii.chave_valencia,
              ipv.a, ipv.b, ipv.c, ipv.calibracao_versao
         FROM itens_instrumento ii
         JOIN item_parameter_version ipv ON ipv.item_id = ii.id
        WHERE ipv.calibracao_versao = (SELECT calibracao_versao FROM versao_escolhida)`,
      [versionId],
    );
    if (catalogo.rows.length === 0) {
      throw new Error(
        `Instrumento ${versionId}: nenhuma versão de calibração cobre todos os itens do instrumento`,
      );
    }
    // A versão gravada em assessment_result é a das linhas REALMENTE usadas,
    // nunca um literal no código -- procedência errada é pior que ausente.
    const calibracaoVersao = catalogo.rows[0].calibracao_versao;

    const itensPorId: Record<string, ItemNoBloco> = {};
    for (const linha of catalogo.rows) {
      itensPorId[linha.item_id] = {
        itemId: linha.item_id,
        dominio: linha.dominio,
        valencia: linha.chave_valencia,
        params: { a: Number(linha.a), b: Number(linha.b), c: Number(linha.c) },
      };
    }

    // Descriptografa em memória; o payload em claro nunca é persistido.
    const respostas = await client.query<{ block_id: string; resposta_criptografada: string }>(
      `SELECT block_id, resposta_criptografada FROM item_response WHERE assessment_application_id = $1`,
      [assessmentApplicationId],
    );

    const comparacoes: ComparacaoPar[] = [];
    for (const linha of respostas.rows) {
      const cifrado =
        typeof linha.resposta_criptografada === 'string'
          ? JSON.parse(linha.resposta_criptografada)
          : linha.resposta_criptografada;
      const aberto = JSON.parse(encryption.decrypt(cifrado)) as {
        itemIds: string[];
        maisId: string;
        menosId: string;
      };
      comparacoes.push(
        ...decomporBlocoEmPares({
          blockId: linha.block_id,
          itemIds: aberto.itemIds,
          maisId: aberto.maisId,
          menosId: aberto.menosId,
        }),
      );
    }

    // Nenhuma dimensão sai daqui sem evidência. Sem esta guarda o estimador
    // devolve o prior sem reclamar e o relatório (Task 11) renderiza θ ≈ 0
    // como se fosse medida.
    const semEvidencia = DIMENSOES.filter(
      (dimensao) => comparacoesRelevantes(comparacoes, dimensao, itensPorId).length === 0,
    );
    if (semEvidencia.length > 0) {
      throw new Error(
        `Assessment ${assessmentApplicationId} não pode ser escorado: sem evidência para ${semEvidencia.join(', ')}`,
      );
    }

    const theta: Record<string, number> = {};
    const seTheta: Record<string, number> = {};
    const escoreBruto: Record<string, number> = {};
    for (const dimensao of DIMENSOES) {
      const estimativa = estimarThetaEAP(comparacoes, dimensao, itensPorId);
      theta[dimensao] = estimativa.theta;
      seTheta[dimensao] = estimativa.se;
      // Contagem de endosso chaveada -- independente de parâmetro e de θ.
      escoreBruto[dimensao] = escoreBrutoPorDimensao(comparacoes, dimensao, itensPorId);
    }

    // Índice de confiança do protocolo: 1 - SE médio, limitado a [0,1].
    // Com parâmetros provisórios isto é indicativo, não garantia -- o
    // relatório (Task 12) marca isso explicitamente.
    const seMedio = DIMENSOES.reduce((acc, d) => acc + seTheta[d], 0) / DIMENSOES.length;
    const protocoloConfianca = Math.max(0, Math.min(1, 1 - seMedio));

    const resultado = await client.query<{ id: string }>(
      `INSERT INTO assessment_result
         (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, respondido_em, calibracao_versao)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7) RETURNING id`,
      [
        personId,
        versionId,
        JSON.stringify(theta),
        JSON.stringify(seTheta),
        JSON.stringify(escoreBruto),
        protocoloConfianca.toFixed(2),
        calibracaoVersao,
      ],
    );

    // A PONTE DE CONSENTIMENTO, na mesma transação do resultado.
    //
    // `assessment_result` é GLOBAL e sem RLS -- quem autoriza um tenant a
    // lê-lo é `result_grant`, e até aqui NADA no produto escrevia nessa
    // tabela (só fixtures de teste). Com a ponte vazia, o `EXISTS` de
    // ReportService.gerar nunca era satisfeito: a rota de relatório
    // devolvia 404 para todo tenant, sempre, e o único caminho vivo para θ
    // acabava sendo o retorno desta função -- sem grant, sem revogação e
    // sem o rodapé obrigatório. Escrever a ponte aqui é o que torna o
    // caminho gated o caminho real.
    //
    // Mesma transação, de propósito: ou existem resultado E autorização de
    // leitura, ou não existe nenhum dos dois. Um resultado órfão de grant
    // seria dado sensível gravado que ninguém pode ler nem revogar.
    //
    // O grant é do tenant que APLICOU o instrumento, e só dele. Reuso por
    // OUTRO tenant é ato diferente, com base legal diferente
    // (consentimento do titular), e nenhum caminho deste serviço o cria.
    const consentId = await this.baseLegalDoProcessoSeletivo(client, tenantId, personId);
    await client.query(
      `INSERT INTO result_grant (assessment_result_id, tenant_id, application_id, consent_id)
       VALUES ($1,$2,$3,$4)`,
      [resultado.rows[0].id, tenantId, applicationId, consentId],
    );

    await client.query(
      `UPDATE assessment_application SET status = 'concluido', concluido_em = now() WHERE id = $1`,
      [assessmentApplicationId],
    );

    await this.emitir(client, tenantId, assessmentApplicationId, 'assessment.completed', {
      assessment_application_id: assessmentApplicationId,
      assessment_result_id: resultado.rows[0].id,
      person_id: personId,
    });

    return {
      assessmentResultId: resultado.rows[0].id,
      theta,
      seTheta,
      escoreBruto,
      calibracaoVersao,
    };
  }

  /**
   * Registro de base legal do tenant que APLICOU o instrumento --
   * `result_grant.consent_id` é NOT NULL e precisa apontar para alguma
   * linha de `consent`.
   *
   * `consent` é, apesar do nome, o registro de BASE LEGAL da plataforma
   * (está escrito assim na trust_0003), e `base_legal` é texto livre
   * justamente porque consentimento não é a única base possível. A base
   * aqui NÃO é consentimento: é a execução de procedimentos preliminares
   * relacionados a contrato (LGPD art. 7, V) -- que é o que de fato
   * aconteceu, o candidato respondeu, dentro da própria candidatura, o
   * instrumento que este tenant aplicou. Gravar 'consentimento' seria
   * registrar como coletado um ato do titular que ninguém coletou, e
   * registro de base legal forjado é pior que registro ausente: ele passa
   * incólume por qualquer auditoria que confie na tabela.
   *
   * Pela mesma razão a finalidade é 'processo_seletivo' (trust_0005) e não
   * 'reaproveitamento_resultado' -- reaproveitamento é reuso por outro
   * tenant, o caso que depende de ato do titular.
   *
   * Reaproveita a linha viva do par (person, tenant) em vez de empilhar
   * uma por assessment: a base legal é do processo seletivo, não de cada
   * aplicação.
   *
   * O QUE ACONTECE COM UMA LINHA REVOGADA, exatamente: ela não é
   * reutilizada nem ressuscitada -- a busca acima filtra
   * `revoked_at IS NULL` e nada aqui escreve `revoked_at = NULL`. Mas se
   * NÃO houver linha viva, este método INSERE uma nova, com a mesma
   * pessoa, o mesmo tenant e a mesma finalidade. Isso é deliberado e é
   * correto para a base legal deste caso (LGPD art. 7, V): um assessment
   * novo, respondido depois, é OUTRO tratamento, com o seu próprio
   * registro e a sua própria data. O que NÃO pode acontecer -- e era o
   * furo -- é a revogação não valer para os grants JÁ EMITIDOS sobre a
   * linha antiga. Quem garante isso é o caminho de leitura:
   * `ReportService.gerar` faz JOIN em `consent` e exige
   * `revoked_at IS NULL` (mais o `ttl_meses`), então revogar fecha na hora
   * todo relatório apoiado naquela base, e o registro novo só autoriza o
   * que vier depois dele.
   */
  private async baseLegalDoProcessoSeletivo(
    client: PoolClient,
    tenantId: string,
    personId: string,
  ): Promise<string> {
    const existente = await client.query<{ id: string }>(
      `SELECT id FROM consent
        WHERE person_id = $1
          AND tenant_id = $2
          AND finalidade = 'processo_seletivo'
          AND revoked_at IS NULL
        ORDER BY granted_at DESC
        LIMIT 1`,
      [personId, tenantId],
    );
    if (existente.rows.length > 0) {
      return existente.rows[0].id;
    }

    const criado = await client.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal)
       VALUES ($1,$2,'processo_seletivo','execucao_procedimento_preliminar_contrato_lgpd_art_7_v')
       RETURNING id`,
      [personId, tenantId],
    );
    return criado.rows[0].id;
  }

  private async emitir(
    client: PoolClient,
    tenantId: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sequence = await nextOutboxSequence(client, aggregateId);
    await this.outbox.write(client, {
      tenantId,
      aggregateType: 'assessment_application',
      aggregateId,
      eventType,
      sequence,
      payload,
      occurredAt: new Date(),
    });
  }
}
