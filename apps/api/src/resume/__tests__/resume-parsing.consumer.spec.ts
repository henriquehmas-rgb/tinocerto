import { Pool } from 'pg';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Redis from 'ioredis';
import { StorageService } from '../../storage/storage.service';
import { ResumeStructuringService } from '../resume-structuring.service';
import { ResumeParsingConsumer } from '../resume-parsing.consumer';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { AnthropicAdapter, OpenAiAdapter } from '../../llm-router/provider-adapter';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { AuditLogService } from '../../trust/audit-log.service';

// Double leve para os testes que NÃO fazem chamada real (a maioria deste
// arquivo -- eles falham antes de o router ser invocado: download()
// lança primeiro para storageKey inexistente, ou o evento é descartado
// como irrelevante antes de chegar em handleResumeUploaded). Necessário
// porque `new OpenAiAdapter()` (Task 1, provider-adapter.ts) chama `new
// OpenAI()` no inicializador de campo da classe, que LANÇA de forma
// síncrona se OPENAI_API_KEY não estiver definida -- mesmo que
// `.complete()` nunca seja chamado. Isso quebraria estes testes mesmo sem
// ANTHROPIC_API_KEY estar em jogo (OPENAI_API_KEY não está configurada na
// VPS ainda). Mesmo padrão de double usado em
// llm-router/__tests__/model-router.service.spec.ts (AdapterFalho).
class AdapterIndisponivel implements ProviderAdapter {
  constructor(public readonly name: 'anthropic' | 'openai') {}
  async complete(): Promise<never> {
    throw new Error(`${this.name} não deveria ser chamado neste teste`);
  }
}

describe('ResumeParsingConsumer.handleResumeUploaded', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Exige as DUAS chaves (não só ANTHROPIC_API_KEY): o teste real abaixo
  // constrói o router com AnthropicAdapter (primário) E OpenAiAdapter
  // (fallback) -- e o construtor de OpenAiAdapter já lança sem
  // OPENAI_API_KEY, então "ter só a chave da Anthropic" não é um estado
  // utilizável para este teste (mesmo critério de
  // model-router.service.spec.ts).
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.OPENAI_API_KEY);
  const maybeIt = hasApiKey ? it : it.skip;
  let personId: string;
  let resumeUploadId: string;
  let tenantId: string;
  // ResumeParsingConsumer abre sua própria conexão ioredis no construtor
  // (não injetada) e este spec o instancia diretamente, sem passar pelo
  // ciclo de vida do Nest (onModuleInit/onModuleDestroy nunca são chamados
  // automaticamente aqui). Sem fechar essa conexão explicitamente, o
  // processo do Jest fica pendurado indefinidamente após imprimir o
  // resultado dos testes -- mesmo padrão de fechamento explícito usado em
  // outbox-to-audit.consumer.spec.ts (Fase 0) para o cliente Redis de lá.
  let consumer: ResumeParsingConsumer | undefined;

  beforeAll(async () => {
    process.env.MINIO_ENDPOINT ??= 'localhost';
    process.env.MINIO_PORT ??= '9000';
    process.env.MINIO_ACCESS_KEY ??= 'tinocerto';
    process.env.MINIO_SECRET_KEY ??= 'dev_local_only';

    // tenantId é criado incondicionalmente (antes do early-return abaixo)
    // porque o teste "marca resume_upload como falhou" logo adiante NÃO é
    // gated por hasApiKey -- roda sempre -- e agora precisa de um tenantId
    // válido para chamar handleResumeUploaded(payload, tenantId). O
    // ModelRouter nunca chega a gravar em llm_call_log nesse teste
    // (storageService.download falha antes disso), mas o tenant precisa
    // existir de verdade para o teste real (maybeIt, abaixo) quando
    // ANTHROPIC_API_KEY estiver presente.
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Resume Consumer Router Ltda','00000000000078','test-tenant-00000000000078') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    if (!hasApiKey) {
      console.warn('ANTHROPIC_API_KEY e/ou OPENAI_API_KEY ausentes -- pulando teste de integração real (ResumeParsingConsumer)');
      return;
    }

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-resume-consumer', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Consumer', 'consumer@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const storageService = new StorageService();
    await storageService.ensureBucket('curriculos');

    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Analista de Operações Pleno na Empresa Exemplo, de 2020 a 2023.', {
      x: 50,
      y: page.getHeight() - 50,
      size: 12,
      font,
    });
    const pdfBytes = Buffer.from(await doc.save());
    await storageService.upload('curriculos', `${personId}/curriculo-teste.pdf`, pdfBytes, 'application/pdf');

    const resumeUpload = await adminPool.query<{ id: string }>(
      `INSERT INTO resume_upload (person_id, storage_key) VALUES ($1, $2) RETURNING id`,
      [personId, `${personId}/curriculo-teste.pdf`],
    );
    resumeUploadId = resumeUpload.rows[0].id;
  });

  afterAll(async () => {
    if (personId) {
      await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personId]);
      await adminPool.query('DELETE FROM resume_upload WHERE person_id = $1', [personId]);
      await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    }
    if (tenantId) {
      await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }
    await adminPool.end();
  });

  afterEach(async () => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  });

  maybeIt('extrai, estrutura e grava person_profile com offset rastreável, marcando resume_upload como processado', async () => {
    consumer = new ResumeParsingConsumer(
      adminPool,
      new StorageService(),
      new ResumeStructuringService(new ModelRouterService(new AuditLogService(), new AnthropicAdapter(), new OpenAiAdapter())),
    );

    await consumer.handleResumeUploaded({ resumeUploadId, storageKey: `${personId}/curriculo-teste.pdf` }, tenantId);

    const profile = await adminPool.query('SELECT experiencias FROM person_profile WHERE person_id = $1', [personId]);
    expect(profile.rows).toHaveLength(1);
    expect(profile.rows[0].experiencias.length).toBeGreaterThan(0);
    expect(profile.rows[0].experiencias[0]).toHaveProperty('offsetInicio');

    const upload = await adminPool.query('SELECT status, texto_extraido FROM resume_upload WHERE id = $1', [resumeUploadId]);
    expect(upload.rows[0].status).toBe('processado');
    expect(upload.rows[0].texto_extraido).toContain('Analista de Operações');
  }, 30000);

  it('marca resume_upload como falhou se a extração/estruturação lançar, sem deixar a transação pela metade', async () => {
    // AdapterIndisponivel (não os adapters reais): este teste falha em
    // storageService.download() -- resumeUploadId/storageKey inexistentes
    // -- antes de o router ser chamado, então não precisa de chave alguma.
    consumer = new ResumeParsingConsumer(
      adminPool,
      new StorageService(),
      new ResumeStructuringService(
        new ModelRouterService(new AuditLogService(), new AdapterIndisponivel('anthropic'), new AdapterIndisponivel('openai')),
      ),
    );

    await expect(
      consumer.handleResumeUploaded({ resumeUploadId: 'id-que-nao-existe', storageKey: 'chave-que-nao-existe.pdf' }, tenantId),
    ).rejects.toThrow();
  });

  describe('caminho real do Redis (processBatch, não handleResumeUploaded direto)', () => {
    // Achado CRITICAL de revisão adversarial: os testes acima chamam
    // handleResumeUploaded() diretamente, então nunca exercitam o parsing
    // real de uma mensagem do Redis Stream -- foi exatamente esse caminho
    // (processBatch) que tinha o bug: `JSON.parse(raw.payload)` é só o
    // payload de DOMÍNIO (ex.: {resume_upload_id, storage_key}), e lia
    // `.event_type` dele -- campo que nunca existe ali (é irmão de
    // `payload`, não aninhado dentro dele -- ver
    // ../resume-parsing.consumer.ts e o commit de referência 1d8816e, que
    // corrigiu o mesmo bug em insights/adverse-impact.consumer.ts). Por
    // isso `undefined !== 'resume.uploaded'` era sempre `true` e TODA
    // mensagem real era ACKed e descartada como "irrelevante" antes de
    // chegar em handleResumeUploaded, silenciosamente -- o consumidor
    // "rodava" sem nunca processar um currículo de verdade. Este bloco
    // publica um evento via XADD no MESMO FORMATO que
    // OutboxPublisher.publishPending grava de verdade e chama processBatch
    // (método privado, acessado via cast -- é exatamente o método que o
    // laço real usa). Não depende de ANTHROPIC_API_KEY: usa um
    // resumeUploadId/storageKey inexistentes de propósito (mesmo padrão do
    // teste acima) só para provar que a mensagem foi RECONHECIDA como
    // relevante e o processamento foi TENTADO -- o que falha depois (por
    // recurso inexistente) é esperado e não é o que este teste verifica.
    const redis = new Redis(process.env.REDIS_URL!);
    const groupName = 'resume_parsing_consumer_group';
    const streamTenantId = '99999999-8888-7777-6666-555555555555';
    const streamKey = `outbox:${streamTenantId}`;

    beforeAll(async () => {
      // streamKey é fixo (tenant sintético, não criado via INSERT INTO
      // tenant a cada execução como tenantId do describe acima) e o Redis
      // real da VPS não é limpo entre execuções da suíte -- sem isto, a
      // mensagem que o teste abaixo deixa pendente de propósito (nunca é
      // ACKed) se acumularia a cada rodada e quebraria a asserção de
      // contagem exata de pendentes.
      await redis.del(streamKey);
    });

    afterAll(async () => {
      await redis.quit();
    });

    it('publica resume.uploaded via XADD (mesmo formato do OutboxPublisher) e processBatch reconhece o evento como relevante (tenta processar, não descarta como irrelevante)', async () => {
      try {
        await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
      }

      await redis.xadd(
        streamKey,
        '*',
        'id', '00000000-0000-0000-0000-000000000201',
        'aggregate_type', 'resume_upload',
        'aggregate_id', 'id-que-nao-existe',
        'event_type', 'resume.uploaded',
        'sequence', '1',
        'payload', JSON.stringify({ resume_upload_id: 'id-que-nao-existe', storage_key: 'chave-que-nao-existe.pdf' }),
        'occurred_at', new Date().toISOString(),
      );

      consumer = new ResumeParsingConsumer(
        adminPool,
        new StorageService(),
        new ResumeStructuringService(
          new ModelRouterService(new AuditLogService(), new AdapterIndisponivel('anthropic'), new AdapterIndisponivel('openai')),
        ),
      );
      // resume_upload_id/storageKey não existem de propósito:
      // handleResumeUploaded lança, e é exatamente esse throw propagando
      // até aqui (via processBatch) que prova que a mensagem foi
      // reconhecida como relevante e o processamento foi TENTADO -- com o
      // bug, event_type nunca batia e a mensagem era ACKed como
      // "irrelevante" antes de chegar em handleResumeUploaded, e
      // processBatch resolvia sem lançar nada.
      await expect(
        (consumer as unknown as { processBatch: (t: string, id: '0' | '>') => Promise<void> }).processBatch(
          streamTenantId,
          '>',
        ),
      ).rejects.toThrow();

      // Como o processamento falhou, a mensagem NÃO foi ACKed (fica
      // pendente para retry -- garantia at-least-once) -- confirma que ela
      // não foi silenciosamente descartada como irrelevante.
      const pendentes = await redis.xpending(streamKey, groupName);
      expect(Number((pendentes as unknown[])[0])).toBe(1);
    });

    it('mensagem de evento IRRELEVANTE (event_type != resume.uploaded) é ACKed e ignorada, não processada', async () => {
      await redis.xadd(
        streamKey,
        '*',
        'id', '00000000-0000-0000-0000-000000000202',
        'aggregate_type', 'resume_upload',
        'aggregate_id', 'qualquer-id',
        'event_type', 'resume.reprocessing_requested', // fora de RELEVANT_EVENT_TYPES
        'sequence', '2',
        'payload', JSON.stringify({ resume_upload_id: 'qualquer-id' }),
        'occurred_at', new Date().toISOString(),
      );

      consumer = new ResumeParsingConsumer(
        adminPool,
        new StorageService(),
        new ResumeStructuringService(
          new ModelRouterService(new AuditLogService(), new AdapterIndisponivel('anthropic'), new AdapterIndisponivel('openai')),
        ),
      );
      await (consumer as unknown as { processBatch: (t: string, id: '0' | '>') => Promise<void> }).processBatch(
        streamTenantId,
        '>',
      );

      // Só a mensagem do teste anterior (que falhou de propósito) continua
      // pendente -- esta foi ACKed, não processada.
      const pendentes = await redis.xpending(streamKey, groupName);
      expect(Number((pendentes as unknown[])[0])).toBe(1);
    });
  });
});
