import { Test } from '@nestjs/testing';
import { CandidateAuthController } from '../candidate-auth.controller';
import { CandidateAccountService } from '../candidate-account.service';
import { CandidateTokenService } from '../candidate-token.service';
import { CandidateJwtService } from '../candidate-jwt.service';
import { PasswordResetService } from '../password-reset.service';
import { DatabaseService } from '../../database/database.service';

describe('CandidateAuthController', () => {
  beforeAll(() => {
    process.env.CANDIDATE_JWT_SECRET ??= 'segredo-de-teste-nao-usar-em-producao';
  });

  it('POST /register delega para CandidateAccountService.register e retorna tokens', async () => {
    const registerMock = jest.fn().mockResolvedValue({ candidateAccountId: 'acc-1', personId: 'person-1' });
    const issueMock = jest.fn().mockResolvedValue({ token: 'refresh-token-fake' });

    const moduleRef = await Test.createTestingModule({
      controllers: [CandidateAuthController],
      providers: [
        { provide: CandidateAccountService, useValue: { register: registerMock, login: jest.fn() } },
        { provide: CandidateTokenService, useValue: { issue: issueMock, rotate: jest.fn(), revokeAll: jest.fn() } },
        { provide: CandidateJwtService, useValue: new CandidateJwtService() },
        { provide: PasswordResetService, useValue: { requestReset: jest.fn(), resetPassword: jest.fn() } },
        { provide: DatabaseService, useValue: { pool: { connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }) } } },
      ],
    }).compile();

    const controller = moduleRef.get(CandidateAuthController);
    const result = await controller.register({
      email: 'novo@teste.com',
      senha: 'senha-forte-123',
      nome: 'Fulano',
      cpf: '11144477735',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBe('refresh-token-fake');
    expect(registerMock).toHaveBeenCalled();
  });
});
