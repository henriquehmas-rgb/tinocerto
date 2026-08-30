import { Pool, PoolClient } from 'pg';
import { EnvelopeEncryptionService } from '../envelope-encryption.service';
import { PersonService, QUERY_HABILIDADES_POR_PESSOA, QUERY_PERFIL_CITAVEL_POR_PESSOA } from '../person.service';

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

  // [Fase 3c / Copiloto] perfilCitavel é o SEGUNDO ponto de leitura de
  // person_profile autorizado neste arquivo -- introduzido porque
  // CandidateSummaryService (src/copilot/candidate-summary.service.ts)
  // precisa de experiencias/formacao/habilidades com citacaoVerbatim/
  // offsetInicio para construir o universo citável do resumo de
  // candidato, e o gate consolidado da Fase 2b proíbe qualquer arquivo
  // fora deste de mencionar `FROM person_profile`/`JOIN person_profile`
  // (ver fase-2b-gate.spec.ts). Sem este método, CandidateSummaryService
  // teria que ler person_profile por SQL direto, violando aquele gate --
  // desvio do plano original da Fase 3c (que previa SQL direto em
  // candidate-summary.service.ts), corrigido durante a execução.
  it('perfilCitavel devolve experiencias/formacao/habilidades com offset, e arrays vazios quando não há perfil', async () => {
    const encryption = new EnvelopeEncryptionService();
    const service = new PersonService(encryption);
    const client = await adminPool.connect();
    try {
      const comPerfil = await service.create(client, {
        cpf: '66677788826',
        nome: 'Pessoa Com Perfil Citavel',
        emailPrincipal: 'com.perfil.citavel@example.com',
      });
      personIdsToClean.push(comPerfil.id);
      await adminPool.query(
        `INSERT INTO person_profile (person_id, resumo, experiencias, formacao, habilidades) VALUES ($1, $2, $3, $4, $5)`,
        [
          comPerfil.id,
          'resumo pré-existente que perfilCitavel NUNCA deve expor',
          JSON.stringify([{ cargo: 'Analista Pleno', citacaoVerbatim: 'Analista Pleno na Empresa X', offsetInicio: 10, offsetFim: 38 }]),
          JSON.stringify([{ curso: 'Engenharia', citacaoVerbatim: 'Engenharia de Software', offsetInicio: 100, offsetFim: 122 }]),
          JSON.stringify([{ nome: 'TypeScript', citacaoVerbatim: 'TypeScript', offsetInicio: 5, offsetFim: 15 }]),
        ],
      );

      const semPerfil = await service.create(client, {
        cpf: '77788899937',
        nome: 'Pessoa Sem Perfil Citavel',
        emailPrincipal: 'sem.perfil.citavel@example.com',
      });
      personIdsToClean.push(semPerfil.id);

      const perfil = await service.perfilCitavel(client, comPerfil.id);
      expect(perfil).not.toHaveProperty('resumo');
      expect(perfil.experiencias).toEqual([{ cargo: 'Analista Pleno', citacaoVerbatim: 'Analista Pleno na Empresa X', offsetInicio: 10, offsetFim: 38 }]);
      expect(perfil.formacao).toEqual([{ curso: 'Engenharia', citacaoVerbatim: 'Engenharia de Software', offsetInicio: 100, offsetFim: 122 }]);
      expect(perfil.habilidades).toEqual([{ nome: 'TypeScript', citacaoVerbatim: 'TypeScript', offsetInicio: 5, offsetFim: 15 }]);
      expect(JSON.stringify(perfil)).not.toContain('resumo pré-existente');

      expect(await service.perfilCitavel(client, semPerfil.id)).toEqual({ experiencias: [], formacao: [], habilidades: [] });
    } finally {
      client.release();
    }
  });

  it('a query de perfilCitavel só seleciona experiencias/formacao/habilidades -- nunca resumo -- allowlist estrutural', () => {
    const colunasPermitidas = ['experiencias', 'formacao', 'habilidades'];
    const selectClause = QUERY_PERFIL_CITAVEL_POR_PESSOA.match(/SELECT([\s\S]*?)FROM/i)?.[1] ?? '';
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
    expect(colunasNaQuery.has('resumo')).toBe(false);
  });

  // [R2a / Kanban Enriquecido] habilidadesEmLote é a versão em lote de
  // habilidades() -- existe porque o funil precisa do score de aderência de
  // todos os candidatos de uma vaga, e chamar habilidades() em laço daria
  // uma consulta por candidato. Este arquivo não tem ctx/TenantContext nem
  // appPool -- person/person_profile são tabelas globais (sem tenant_id),
  // então os demais testes desta suíte já exercitam o serviço direto com
  // adminPool.connect(); este describe segue o mesmo padrão.
  describe('habilidadesEmLote', () => {
    let pessoaComPerfil: string;
    let pessoaSemPerfil: string;

    beforeAll(async () => {
      const encryption = new EnvelopeEncryptionService();
      const service = new PersonService(encryption);
      const client = await adminPool.connect();
      try {
        const a = await service.create(client, {
          cpf: '39053344705',
          nome: 'Com Perfil',
          emailPrincipal: 'com@lote.example',
        });
        const b = await service.create(client, {
          cpf: '19131243055',
          nome: 'Sem Perfil',
          emailPrincipal: 'sem@lote.example',
        });
        pessoaComPerfil = a.id;
        pessoaSemPerfil = b.id;
      } finally {
        client.release();
      }
      await adminPool.query(
        `INSERT INTO person_profile (person_id, experiencias, formacao, habilidades)
         VALUES ($1, '[]'::jsonb, '[]'::jsonb, $2::jsonb)`,
        [pessoaComPerfil, JSON.stringify([{ nome: 'TypeScript' }, { nome: 'Postgres' }])],
      );
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM person_profile WHERE person_id = ANY($1)', [
        [pessoaComPerfil, pessoaSemPerfil],
      ]);
      await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [[pessoaComPerfil, pessoaSemPerfil]]);
    });

    it('devolve os nomes das habilidades por pessoa', async () => {
      const service = new PersonService(new EnvelopeEncryptionService());
      const client = await adminPool.connect();
      try {
        const mapa = await service.habilidadesEmLote(client, [pessoaComPerfil, pessoaSemPerfil]);
        expect(mapa.get(pessoaComPerfil)).toEqual(['TypeScript', 'Postgres']);
      } finally {
        client.release();
      }
    });

    it('omite do mapa quem não tem perfil, em vez de devolver lista vazia', async () => {
      const service = new PersonService(new EnvelopeEncryptionService());
      const client = await adminPool.connect();
      try {
        const mapa = await service.habilidadesEmLote(client, [pessoaComPerfil, pessoaSemPerfil]);
        expect(mapa.has(pessoaSemPerfil)).toBe(false);
      } finally {
        client.release();
      }
    });

    it('com lista vazia não consulta o banco e devolve mapa vazio', async () => {
      const service = new PersonService(new EnvelopeEncryptionService());
      const client = { query: jest.fn() } as unknown as PoolClient;
      const mapa = await service.habilidadesEmLote(client, []);
      expect(mapa.size).toBe(0);
      expect(client.query).not.toHaveBeenCalled();
    });
  });
});
