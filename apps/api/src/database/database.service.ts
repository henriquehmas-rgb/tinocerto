import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    // Conecta como APP_DATABASE_URL (role app_runtime — NOSUPERUSER,
    // NOBYPASSRLS), nunca como DATABASE_URL (role dono do schema,
    // superuser/BYPASSRLS nesta fase de dev). Superuser sempre bypassa
    // RLS, inclusive FORCE ROW LEVEL SECURITY — se este provider
    // conectasse com DATABASE_URL, toda a proteção de RLS construída na
    // Fase 0 (Tasks 5-8, 11, 13, 18) estaria provada correta nos testes
    // mas não protegeria nada contra código de produção real escrito
    // contra este service, que é o único ponto @Global de acesso ao
    // banco que a aplicação vai injetar (ver database.module.ts).
    //
    // migrate.ts continua usando DATABASE_URL de propósito — migrations
    // precisam de privilégio de owner e constrói seu próprio Pool,
    // independente deste service.
    //
    // Achado Important da verificação adversarial dos fixes finais da
    // Fase 0 (Task 18 bis): sem esta validação, se APP_DATABASE_URL
    // estiver ausente do ambiente, `new Pool({ connectionString:
    // undefined })` cai SILENCIOSAMENTE no fallback de variáveis libpq
    // (PGUSER/PGPASSWORD/PGHOST/etc.), que podem resolver de volta para
    // um role superuser (confirmado ao vivo nesta VPS, onde resolve para
    // `tinocerto`) — reintroduzindo o vazamento de RLS inteiro sem
    // nenhum erro visível. Falhar aqui, no boot, é intencional: melhor a
    // aplicação nunca subir do que subir com privilégio de superuser.
    if (!process.env.APP_DATABASE_URL) {
      throw new Error(
        'APP_DATABASE_URL ausente — DatabaseService nunca deve conectar sem essa variável, ver Task 18/fix final da Fase 0',
      );
    }
    // max/connectionTimeoutMillis explícitos: os defaults do pg (max=10,
    // espera infinita em pool.connect() quando saturado) deixam a
    // aplicação inteira vulnerável a stall silencioso sob carga
    // concorrente. Chamadas de LLM (BarsGenerationService,
    // ModelRouterService com fallback entre providers) podem segurar uma
    // conexão do pool por até ~120s no pior caso (2x timeout de 60s). Um
    // burst de requisições concorrentes ao endpoint de geração de roteiro
    // de entrevista via IA pode consumir todas as conexões do pool por
    // até 120s cada — qualquer OUTRA requisição de QUALQUER outro
    // endpoint que precise de conexão nesse intervalo (login, listagem
    // de vaga, submissão de scorecard) ficaria bloqueada em
    // pool.connect() indefinidamente, sem erro, sem timeout, até uma
    // conexão liberar.
    //
    // connectionTimeoutMillis NÃO resolve esse problema de fundo — só
    // transforma "trava para sempre, silenciosamente" em "falha com erro
    // claro depois de 10s", o que já é uma melhoria real de robustez.
    // A correção definitiva (rate-limit no endpoint de geração de
    // roteiro, ou uma pool dedicada para operações de LLM) fica fora do
    // escopo deste fix pontual.
    this.pool = new Pool({
      connectionString: process.env.APP_DATABASE_URL,
      max: 20,
      connectionTimeoutMillis: 10_000,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
