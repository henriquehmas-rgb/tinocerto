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
}
