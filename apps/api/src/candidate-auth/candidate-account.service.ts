import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PersonService } from '../talent/person.service';
import { PasswordService } from './password.service';

export interface RegisterInput {
  email: string;
  senha: string;
  nome: string;
  cpf: string;
}

export interface LoginInput {
  email: string;
  senha: string;
}

@Injectable()
export class CandidateAccountService {
  constructor(
    private readonly personService: PersonService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(client: PoolClient, input: RegisterInput): Promise<{ candidateAccountId: string; personId: string }> {
    const existingEmail = await client.query(`SELECT 1 FROM candidate_account WHERE lower(email) = lower($1)`, [
      input.email,
    ]);
    if (existingEmail.rows.length > 0) {
      // ConflictException (não `Error` genérico) -- revisão de código round 1:
      // sem isso, o handler padrão do Nest transforma qualquer `Error`
      // não-HTTP num 500 "Internal server error" genérico, descartando esta
      // mensagem em português e escondendo de quem chamou que a causa real é
      // um conflito de e-mail já cadastrado (409), não uma falha do servidor.
      throw new ConflictException('Este e-mail já tem uma conta de candidato -- faça login em vez de se cadastrar novamente');
    }

    let personId: string;
    const existingPerson = await this.personService.findByCpf(client, input.cpf);
    if (existingPerson) {
      personId = existingPerson.id;
    } else {
      const created = await this.personService.create(client, {
        cpf: input.cpf,
        nome: input.nome,
        emailPrincipal: input.email,
      });
      personId = created.id;
    }

    const senhaHash = await this.passwordService.hash(input.senha);
    const result = await client.query<{ id: string }>(
      `INSERT INTO candidate_account (person_id, email, senha_hash) VALUES ($1, $2, $3) RETURNING id`,
      [personId, input.email, senhaHash],
    );

    return { candidateAccountId: result.rows[0].id, personId };
  }

  async login(client: PoolClient, input: LoginInput): Promise<{ candidateAccountId: string; personId: string }> {
    const result = await client.query<{ id: string; person_id: string; senha_hash: string }>(
      `SELECT id, person_id, senha_hash FROM candidate_account WHERE lower(email) = lower($1)`,
      [input.email],
    );
    if (result.rows.length === 0) {
      // UnauthorizedException -- ver comentário em `register` acima sobre por
      // que `Error` genérico não serve aqui: login com credenciais inválidas
      // é o caminho de falha mais comum de qualquer formulário de login
      // público, precisa voltar 401 com esta mensagem, não 500 genérico.
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const row = result.rows[0];
    const valid = await this.passwordService.verify(row.senha_hash, input.senha);
    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return { candidateAccountId: row.id, personId: row.person_id };
  }
}
