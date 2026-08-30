import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { EnvelopeEncryptionService, EncryptedPayload } from './envelope-encryption.service';

export interface CreatePersonInput {
  cpf: string;
  nome: string;
  emailPrincipal: string;
}

export interface PersonRecord {
  id: string;
  nome: string;
  emailPrincipal: string;
  criadoEm: Date;
}

// [Fase 3c / Copiloto] Item de person_profile.experiencias|formacao|
// habilidades com a citação verbatim já verificada na Fase 1 (parsing de
// currículo) e o offset que localiza aquela citação no texto bruto
// original -- offsetInicio null significa que a Fase 1 NÃO conseguiu
// localizar a citação (ver locate-verbatim-offset.ts), então o item nunca
// deve ser oferecido como fonte citável.
export interface ItemPerfilComOffset {
  citacaoVerbatim: string;
  offsetInicio: number | null;
}

export interface PerfilCitavel {
  experiencias: ItemPerfilComOffset[];
  formacao: ItemPerfilComOffset[];
  habilidades: ItemPerfilComOffset[];
}

function hashCpf(cpf: string): string {
  const pepper = process.env.CPF_HASH_PEPPER;
  if (!pepper) {
    throw new Error('CPF_HASH_PEPPER ausente — PersonService nunca deve hashear CPF sem pepper configurado');
  }
  // Normaliza (remove máscara) antes de hashear -- "111.222.333-96" e
  // "11122233396" devem produzir o mesmo hash, senão o unique index de
  // duplicidade não pega o mesmo CPF digitado com formatação diferente.
  const digitsOnly = cpf.replace(/\D/g, '');
  return createHash('sha256').update(`${digitsOnly}:${pepper}`).digest('hex');
}

// Allowlist estrutural: esta query só pode selecionar a coluna
// `habilidades` de person_profile -- nunca `resumo`/`experiencias`/
// `formacao` (dados mais sensíveis e menos auditáveis por feature nomeada).
// Testada em __tests__/person.service.spec.ts.
export const QUERY_HABILIDADES_POR_PESSOA = `SELECT habilidades FROM person_profile WHERE person_id = $1`;

// Allowlist estrutural irmã de QUERY_HABILIDADES_POR_PESSOA: mesma coluna,
// mesma tabela, só que para várias pessoas de uma vez. Existe porque o
// funil precisa do score de aderência de todos os candidatos de uma vaga e
// chamar habilidades() em laço daria uma consulta por candidato.
// Selecionar `person_id` aqui é necessário para montar o Map de volta --
// nunca selecione `resumo`/`experiencias`/`formacao`.
export const QUERY_HABILIDADES_EM_LOTE = `SELECT person_id, habilidades FROM person_profile WHERE person_id = ANY($1)`;

// [Fase 3c / Copiloto] Allowlist estrutural irmã da acima -- segunda (e
// última) query autorizada contra person_profile fora deste arquivo.
// Seleciona SÓ experiencias/formacao/habilidades (cada item com
// citacaoVerbatim/offsetInicio) -- NUNCA `resumo` (decisão 6 do design
// spec da Fase 3c: o campo "vivo" global de resumo do candidato nunca é
// lido nem escrito pelo Copiloto, porque person_profile não tem
// tenant_id e gravar/ler o resumo interpretado por um tenant ali
// vazaria/contaminaria a identidade global do candidato). Devolve estes
// 3 arrays para o Copiloto (CandidateSummaryService, src/copilot/)
// construir o universo citável do resumo de candidato -- ver
// construirTrechosCitaveis em copilot/build-citable-snippets.ts.
export const QUERY_PERFIL_CITAVEL_POR_PESSOA = `SELECT experiencias, formacao, habilidades FROM person_profile WHERE person_id = $1`;

@Injectable()
export class PersonService {
  constructor(private readonly encryption: EnvelopeEncryptionService) {}

  async create(client: PoolClient, input: CreatePersonInput): Promise<{ id: string }> {
    const id = randomUUID();
    const cpfHash = hashCpf(input.cpf);
    const cpfEncriptado: EncryptedPayload = this.encryption.encrypt(input.cpf.replace(/\D/g, ''));

    await client.query(
      `INSERT INTO person (id, cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, cpfHash, JSON.stringify(cpfEncriptado), input.nome, input.emailPrincipal],
    );

    return { id };
  }

  async findByCpf(client: PoolClient, cpf: string): Promise<PersonRecord | null> {
    const cpfHash = hashCpf(cpf);
    const result = await client.query<{
      id: string;
      nome: string;
      email_principal: string;
      criado_em: Date;
    }>(
      `SELECT id, nome, email_principal, criado_em FROM person WHERE cpf_hash = $1`,
      [cpfHash],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      nome: row.nome,
      emailPrincipal: row.email_principal,
      criadoEm: row.criado_em,
    };
  }

  /**
   * Único ponto de leitura de `person_profile.habilidades` do sistema --
   * qualquer módulo que precise das skills de uma pessoa (ex.: matching/
   * AdherenceService, Fase 2b) passa por aqui, nunca por SQL direto contra
   * `person_profile`. Devolve só os nomes (não a citação verbatim/offset --
   * quem precisar disso lê o perfil completo por outro caminho).
   */
  async habilidades(client: PoolClient, personId: string): Promise<string[]> {
    const result = await client.query<{ habilidades: { nome: string }[] | null }>(QUERY_HABILIDADES_POR_PESSOA, [
      personId,
    ]);
    if (result.rows.length === 0) return [];
    return (result.rows[0].habilidades ?? []).map((h) => h.nome);
  }

  /**
   * Versão em lote de habilidades(). Mesmo contrato: devolve só os nomes.
   * Pessoa sem perfil simplesmente NÃO aparece no Map -- quem consome trata
   * ausência como lista vazia. Lista vazia de entrada não toca o banco.
   */
  async habilidadesEmLote(client: PoolClient, personIds: string[]): Promise<Map<string, string[]>> {
    const mapa = new Map<string, string[]>();
    if (personIds.length === 0) return mapa;

    const result = await client.query<{ person_id: string; habilidades: { nome: string }[] | null }>(
      QUERY_HABILIDADES_EM_LOTE,
      [personIds],
    );
    for (const row of result.rows) {
      mapa.set(row.person_id, (row.habilidades ?? []).map((h) => h.nome));
    }
    return mapa;
  }

  /**
   * [Fase 3c / Copiloto] Terceiro (e último) ponto de leitura de
   * person_profile neste arquivo -- devolve experiencias/
   * formacao/habilidades com citacaoVerbatim/offsetInicio de cada item,
   * para o Copiloto construir o universo citável do resumo de candidato
   * (gate consolidado da Fase 2b exige que nenhum arquivo fora deste
   * mencione `FROM person_profile`/`JOIN person_profile` -- este método é
   * como CandidateSummaryService obedece essa regra em vez de duplicar a
   * leitura). Nunca seleciona `resumo` -- ver comentário de
   * QUERY_PERFIL_CITAVEL_POR_PESSOA acima.
   */
  async perfilCitavel(client: PoolClient, personId: string): Promise<PerfilCitavel> {
    const result = await client.query<PerfilCitavel>(QUERY_PERFIL_CITAVEL_POR_PESSOA, [personId]);
    if (result.rows.length === 0) {
      return { experiencias: [], formacao: [], habilidades: [] };
    }
    const row = result.rows[0];
    return {
      experiencias: row.experiencias ?? [],
      formacao: row.formacao ?? [],
      habilidades: row.habilidades ?? [],
    };
  }
}
