import { Test } from '@nestjs/testing';
import { DatabaseModule } from './database.module';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  it('executa uma query simples contra o Postgres real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const db = moduleRef.get(DatabaseService);
    const rows = await db.query<{ value: number }>('SELECT 1 as value');

    expect(rows).toEqual([{ value: 1 }]);
    await moduleRef.close();
  });

  // CRITICAL 1 da revisão final consolidada da Fase 0: DatabaseService
  // conectava com DATABASE_URL (role dono do schema, superuser nesta fase
  // de dev — rolsuper=t, rolbypassrls=t). Superuser SEMPRE bypassa RLS,
  // inclusive FORCE ROW LEVEL SECURITY, então toda a proteção construída
  // nas Tasks 5-8, 11, 13, 18 estava provada correta apenas nos testes
  // (que constroem manualmente um pool com credenciais app_runtime), nunca
  // no caminho de produção real. Este teste instancia DatabaseService
  // exatamente como o DI real instanciaria (via DatabaseModule, sem
  // reescrever a connection string à mão como os specs de RLS fazem) e
  // prova que o pool de PRODUÇÃO conecta como app_runtime — não
  // superuser, não bypassrls.
  it('conecta como app_runtime (não superuser, não bypassa RLS) — caminho de produção real via DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const db = moduleRef.get(DatabaseService);
    const rows = await db.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT current_user AS user, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('app_runtime');
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);

    await moduleRef.close();
  });
});
