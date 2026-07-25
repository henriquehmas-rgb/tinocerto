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
});
