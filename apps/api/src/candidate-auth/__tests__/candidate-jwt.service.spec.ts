import { CandidateJwtService } from '../candidate-jwt.service';

describe('CandidateJwtService', () => {
  const originalSecret = process.env.CANDIDATE_JWT_SECRET;

  beforeAll(() => {
    process.env.CANDIDATE_JWT_SECRET = 'segredo-de-teste-nao-usar-em-producao';
  });

  afterAll(() => {
    process.env.CANDIDATE_JWT_SECRET = originalSecret;
  });

  it('assina e verifica um token de volta para o payload original', () => {
    const service = new CandidateJwtService();
    const token = service.sign({ candidateAccountId: 'acc-1', personId: 'person-1' });
    const decoded = service.verify(token);
    expect(decoded.candidateAccountId).toBe('acc-1');
    expect(decoded.personId).toBe('person-1');
  });

  it('lança ao verificar um token adulterado', () => {
    const service = new CandidateJwtService();
    const token = service.sign({ candidateAccountId: 'acc-1', personId: 'person-1' });
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => service.verify(tampered)).toThrow();
  });

  it('lança ao verificar um token expirado', () => {
    // Não depende de relógio/espera real (flaky por natureza -- jsonwebtoken
    // trunca "exp" para segundos inteiros, então um expiresIn de poucos ms
    // não garante ter "passado" no momento do verify). Em vez disso,
    // construímos o token diretamente com jsonwebtoken usando um "exp" já
    // no passado, com o mesmo segredo que o service usa.
    const jwtLib = jest.requireActual('jsonwebtoken');
    const expiredToken = jwtLib.sign(
      { candidateAccountId: 'acc-1', personId: 'person-1', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.CANDIDATE_JWT_SECRET,
    );

    const service = new CandidateJwtService();
    expect(() => service.verify(expiredToken)).toThrow();
  });

  it('lança se CANDIDATE_JWT_SECRET não estiver setada', () => {
    delete process.env.CANDIDATE_JWT_SECRET;
    expect(() => new CandidateJwtService()).toThrow(/CANDIDATE_JWT_SECRET/);
    process.env.CANDIDATE_JWT_SECRET = 'segredo-de-teste-nao-usar-em-producao';
  });
});
