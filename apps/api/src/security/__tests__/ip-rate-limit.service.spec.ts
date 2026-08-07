// apps/api/src/security/__tests__/ip-rate-limit.service.spec.ts
import { IpRateLimitService } from '../ip-rate-limit.service';

describe('IpRateLimitService.checkAndIncrement', () => {
  let service: IpRateLimitService;

  beforeEach(() => {
    service = new IpRateLimitService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('permite requisições até o limite e bloqueia a que excede, na mesma janela', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const check = await service.checkAndIncrement('teste-limite', ip, 3, 60, now);
      expect(check.allowed).toBe(true);
    }
    const quarta = await service.checkAndIncrement('teste-limite', ip, 3, 60, now);
    expect(quarta.allowed).toBe(false);
    expect(quarta.remaining).toBe(0);
  });

  it('escopos diferentes sob o mesmo IP têm contadores independentes', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const now = Date.now();
    await service.checkAndIncrement('login', ip, 1, 60, now);
    const loginEsgotado = await service.checkAndIncrement('login', ip, 1, 60, now);
    expect(loginEsgotado.allowed).toBe(false);

    // "register" não foi afetado pelo consumo de "login" no mesmo IP.
    const registerAindaLivre = await service.checkAndIncrement('register', ip, 1, 60, now);
    expect(registerAindaLivre.allowed).toBe(true);
  });

  it('janelas diferentes (now distante) resetam a contagem', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 2}`;
    const now = Date.now();
    await service.checkAndIncrement('janela', ip, 1, 60, now);
    const proximaJanela = now + 61_000;
    const check = await service.checkAndIncrement('janela', ip, 1, 60, proximaJanela);
    expect(check.allowed).toBe(true);
  });
});
