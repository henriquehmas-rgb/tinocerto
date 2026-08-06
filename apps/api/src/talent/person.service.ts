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
}
