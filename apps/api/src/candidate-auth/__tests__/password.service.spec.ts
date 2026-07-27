import { PasswordService } from '../password.service';

describe('PasswordService (Argon2id)', () => {
  it('gera um hash que verifica corretamente contra a senha original', async () => {
    const service = new PasswordService();
    const hash = await service.hash('senha-super-secreta-123');
    expect(hash).not.toContain('senha-super-secreta-123');
    await expect(service.verify(hash, 'senha-super-secreta-123')).resolves.toBe(true);
  });

  it('rejeita uma senha errada', async () => {
    const service = new PasswordService();
    const hash = await service.hash('senha-correta');
    await expect(service.verify(hash, 'senha-errada')).resolves.toBe(false);
  });

  it('duas cifragens da mesma senha produzem hashes diferentes (salt aleatorio)', async () => {
    const service = new PasswordService();
    const a = await service.hash('mesma-senha');
    const b = await service.hash('mesma-senha');
    expect(a).not.toBe(b);
  });

  it('o hash usa o algoritmo argon2id (identificavel pelo prefixo padrao da lib)', async () => {
    const service = new PasswordService();
    const hash = await service.hash('qualquer-senha');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });
});
