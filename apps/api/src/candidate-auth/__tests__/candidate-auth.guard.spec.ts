import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CandidateAuthGuard } from '../candidate-auth.guard';
import { CandidateJwtService } from '../candidate-jwt.service';

beforeAll(() => {
  process.env.CANDIDATE_JWT_SECRET ??= 'segredo-de-teste-nao-usar-em-producao';
});

function buildContext(headers: Record<string, string>) {
  const req: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('CandidateAuthGuard', () => {
  it('popula req.candidateAccountId/personId a partir de um Bearer token válido', () => {
    const jwtService = new CandidateJwtService();
    const token = jwtService.sign({ candidateAccountId: 'acc-1', personId: 'person-1' });
    const guard = new CandidateAuthGuard(jwtService);
    const { context, req } = buildContext({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(context)).toBe(true);
    expect(req.candidateAccountId).toBe('acc-1');
    expect(req.personId).toBe('person-1');
  });

  it('lança UnauthorizedException sem header authorization', () => {
    const jwtService = new CandidateJwtService();
    const guard = new CandidateAuthGuard(jwtService);
    const { context } = buildContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('lança UnauthorizedException com token inválido', () => {
    const jwtService = new CandidateJwtService();
    const guard = new CandidateAuthGuard(jwtService);
    const { context } = buildContext({ authorization: 'Bearer token-invalido' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
