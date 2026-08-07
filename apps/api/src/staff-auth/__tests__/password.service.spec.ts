import { PasswordService } from '../password.service';

describe('PasswordService (staff)', () => {
  it('hash e verify funcionam para a senha certa e rejeitam a errada', async () => {
    const service = new PasswordService();
    const hash = await service.hash('senha-forte-123');
    expect(await service.verify(hash, 'senha-forte-123')).toBe(true);
    expect(await service.verify(hash, 'senha-errada')).toBe(false);
  });
});
