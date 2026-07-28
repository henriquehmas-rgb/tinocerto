import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { PersonService } from '../../talent/person.service';
import { PasswordService } from '../password.service';
import { CandidateAccountService } from '../candidate-account.service';

describe('CandidateAccountService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-000000000000';

  beforeAll(() => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');
    process.env.CPF_HASH_PEPPER ??= 'pepper-de-teste';
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM candidate_account WHERE email LIKE '%candidate-account-test%'`);
    await adminPool.query(`DELETE FROM person WHERE email_principal LIKE '%candidate-account-test%'`);
    await adminPool.end();
    await appPool.end();
  });

  it('registra uma conta nova criando um person novo', async () => {
    const ctx = new TenantContext(appPool);
    const encryption = new EnvelopeEncryptionService();
    const service = new CandidateAccountService(new PersonService(encryption), new PasswordService());

    const result = await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.register(client, {
        email: 'novo@candidate-account-test.com',
        senha: 'senha-forte-123',
        nome: 'Candidato Novo',
        cpf: '11144477735',
      }),
    );
    expect(result.candidateAccountId).toBeDefined();
    expect(result.personId).toBeDefined();
  });

  it('rejeita registro com e-mail já usado por outra conta', async () => {
    const ctx = new TenantContext(appPool);
    const encryption = new EnvelopeEncryptionService();
    const service = new CandidateAccountService(new PersonService(encryption), new PasswordService());

    await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.register(client, {
        email: 'duplicado@candidate-account-test.com',
        senha: 'senha-forte-123',
        nome: 'Primeiro',
        cpf: '22255588846',
      }),
    );

    await expect(
      ctx.run(PLACEHOLDER_TENANT, (client) =>
        service.register(client, {
          email: 'duplicado@candidate-account-test.com',
          senha: 'outra-senha',
          nome: 'Segundo',
          cpf: '33366699957',
        }),
      ),
    ).rejects.toThrow(/e-mail/);
  });

  it('registro com CPF já existente (person criado por outro fluxo) vincula ao person existente, não duplica', async () => {
    const ctx = new TenantContext(appPool);
    const encryption = new EnvelopeEncryptionService();
    const personService = new PersonService(encryption);
    const service = new CandidateAccountService(personService, new PasswordService());

    const existingPerson = await ctx.run(PLACEHOLDER_TENANT, (client) =>
      personService.create(client, {
        cpf: '44477700068',
        nome: 'Pessoa Pré-existente',
        emailPrincipal: 'pre-existente@candidate-account-test.com',
      }),
    );

    const result = await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.register(client, {
        email: 'vinculo@candidate-account-test.com',
        senha: 'senha-forte-123',
        nome: 'Nome no Cadastro',
        cpf: '44477700068',
      }),
    );

    expect(result.personId).toBe(existingPerson.id);
  });

  it('login com senha correta retorna a conta, com senha errada lança', async () => {
    const ctx = new TenantContext(appPool);
    const encryption = new EnvelopeEncryptionService();
    const service = new CandidateAccountService(new PersonService(encryption), new PasswordService());

    await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.register(client, {
        email: 'login@candidate-account-test.com',
        senha: 'senha-correta-123',
        nome: 'Login Teste',
        cpf: '55588811179',
      }),
    );

    const logged = await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.login(client, { email: 'login@candidate-account-test.com', senha: 'senha-correta-123' }),
    );
    expect(logged.candidateAccountId).toBeDefined();

    await expect(
      ctx.run(PLACEHOLDER_TENANT, (client) =>
        service.login(client, { email: 'login@candidate-account-test.com', senha: 'senha-errada' }),
      ),
    ).rejects.toThrow(/credenciais/i);
  });
});
