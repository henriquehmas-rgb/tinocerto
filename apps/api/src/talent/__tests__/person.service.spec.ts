import { Pool } from 'pg';
import { EnvelopeEncryptionService } from '../envelope-encryption.service';
import { PersonService, QUERY_HABILIDADES_POR_PESSOA } from '../person.service';

describe('PersonService', () => {
  const originalKek = process.env.ENVELOPE_ENCRYPTION_KEK;
  const originalPepper = process.env.CPF_HASH_PEPPER;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const personIdsToClean: string[] = [];

  beforeAll(() => {
    process.env.ENVELOPE_ENCRYPTION_KEK = Buffer.alloc(32, 7).toString('base64');
    process.env.CPF_HASH_PEPPER = 'pepper-de-teste-nao-usar-em-producao';
  });

  afterAll(async () => {
    if (personIdsToClean.length > 0) {
      await adminPool.query('DELETE FROM person_profile WHERE person_id = ANY($1)', [personIdsToClean]);
      await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [personIdsToClean]);
    }
    await adminPool.end();
    process.env.ENVELOPE_ENCRYPTION_KEK = originalKek;
    process.env.CPF_HASH_PEPPER = originalPepper;
  });

  it('cria uma pessoa e não retorna cpf em claro nem hash/encriptado', async () => {
    const encryption = new EnvelopeEncryptionService();
    const service = new PersonService(encryption);
    const client = await adminPool.connect();
    try {
      const result = await service.create(client, {
        cpf: '11122233396',
        nome: 'Ana Beatriz Souza',
        emailPrincipal: 'ana.souza@example.com',
      });
      personIdsToClean.push(result.id);

      expect(result.id).toBeDefined();
      expect(result).not.toHaveProperty('cpf');
      expect(result).not.toHaveProperty('cpfHash');
      expect(result).not.toHaveProperty('cpfEncriptado');

      const raw = await adminPool.query('SELECT cpf_hash, cpf_encriptado, nome FROM person WHERE id = $1', [
        result.id,
      ]);
      expect(raw.rows[0].nome).toBe('Ana Beatriz Souza');
      // O CPF em claro nunca aparece em nenhuma coluna da linha.
      expect(JSON.stringify(raw.rows[0])).not.toContain('11122233396');
    } finally {
      client.release();
    }
  });

  it('findByCpf localiza a pessoa pelo CPF em claro (via hash), sem decifrar em massa', async () => {
    const encryption = new EnvelopeEncryptionService();
    const service = new PersonService(encryption);
    const client = await adminPool.connect();
    try {
      const created = await service.create(client, {
        cpf: '22233344495',
        nome: 'Carlos Eduardo Lima',
        emailPrincipal: 'carlos.lima@example.com',
      });
      personIdsToClean.push(created.id);

      const found = await service.findByCpf(client, '22233344495');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.nome).toBe('Carlos Eduardo Lima');

      const notFound = await service.findByCpf(client, '99988877766');
      expect(notFound).toBeNull();
    } finally {
      client.release();
    }
  });

  it('rejeita CPF duplicado (unique index em cpf_hash)', async () => {
    const encryption = new EnvelopeEncryptionService();
    const service = new PersonService(encryption);
    const client = await adminPool.connect();
    try {
      const first = await service.create(client, {
        cpf: '33344455594',
        nome: 'Primeira Pessoa',
        emailPrincipal: 'primeira@example.com',
      });
      personIdsToClean.push(first.id);

      await expect(
        service.create(client, {
          cpf: '33344455594',
          nome: 'Pessoa Duplicada',
          emailPrincipal: 'duplicada@example.com',
        }),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      client.release();
    }
  });

  it('habilidades devolve os nomes das skills do person_profile, e array vazio quando não há perfil', async () => {
    const encryption = new EnvelopeEncryptionService();
    const service = new PersonService(encryption);
    const client = await adminPool.connect();
    try {
      const comPerfil = await service.create(client, {
        cpf: '44455566604',
        nome: 'Pessoa Com Perfil De Skills',
        emailPrincipal: 'com.skills@example.com',
      });
      personIdsToClean.push(comPerfil.id);
      await adminPool.query('INSERT INTO person_profile (person_id, habilidades) VALUES ($1, $2)', [
        comPerfil.id,
        JSON.stringify([
          { nome: 'TypeScript', citacaoVerbatim: 'TypeScript' },
          { nome: 'SQL', citacaoVerbatim: 'SQL' },
        ]),
      ]);

      const semPerfil = await service.create(client, {
        cpf: '55566677715',
        nome: 'Pessoa Sem Perfil',
        emailPrincipal: 'sem.perfil.talent@example.com',
      });
      personIdsToClean.push(semPerfil.id);

      expect(await service.habilidades(client, comPerfil.id)).toEqual(['TypeScript', 'SQL']);
      expect(await service.habilidades(client, semPerfil.id)).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('a query de habilidades só seleciona a coluna habilidades de person_profile -- allowlist estrutural', () => {
    // Subconjunto bidirecional, não blocklist: checar só a AUSÊNCIA de
    // resumo/experiencias/formacao deixaria passar qualquer coluna futura
    // não antecipada (telefone, endereço, foto -- plausíveis num perfil de
    // RH). Mesmo achado de revisão adversarial que corrigiu o allowlist de
    // AdherenceService (ver adherence.service.spec.ts) -- aqui era a MESMA
    // classe de lacuna, só que num arquivo diferente.
    const colunasPermitidas = ['habilidades'];
    const selectClause = QUERY_HABILIDADES_POR_PESSOA.match(/SELECT([\s\S]*?)FROM/i)?.[1] ?? '';
    const colunasNaQuery = new Set(
      selectClause
        .split(/[\s,]+/)
        .map((token) => token.replace(/^[a-z]+\./i, '').toLowerCase())
        .filter(Boolean),
    );

    for (const permitida of colunasPermitidas) {
      expect(colunasNaQuery.has(permitida)).toBe(true);
    }
    for (const coluna of colunasNaQuery) {
      expect(colunasPermitidas).toContain(coluna);
    }
  });
});
