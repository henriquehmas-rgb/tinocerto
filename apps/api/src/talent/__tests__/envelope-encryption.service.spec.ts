import { EnvelopeEncryptionService } from '../envelope-encryption.service';

describe('EnvelopeEncryptionService', () => {
  const originalKek = process.env.ENVELOPE_ENCRYPTION_KEK;

  beforeAll(() => {
    // KEK de 32 bytes (256 bits) em base64, só para teste — a real vem de
    // variável de ambiente de produção, nunca hardcoded no código.
    process.env.ENVELOPE_ENCRYPTION_KEK = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    process.env.ENVELOPE_ENCRYPTION_KEK = originalKek;
  });

  it('cifra e decifra de volta para o texto original', () => {
    const service = new EnvelopeEncryptionService();
    const payload = service.encrypt('12345678901');
    expect(payload.ciphertext).not.toContain('12345678901');
    const decrypted = service.decrypt(payload);
    expect(decrypted).toBe('12345678901');
  });

  it('duas cifragens do mesmo texto produzem ciphertext e DEK diferentes (IV/DEK aleatórios por chamada)', () => {
    const service = new EnvelopeEncryptionService();
    const a = service.encrypt('12345678901');
    const b = service.encrypt('12345678901');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.iv).not.toBe(b.iv);
  });

  it('lança erro claro se ENVELOPE_ENCRYPTION_KEK não estiver setada', () => {
    delete process.env.ENVELOPE_ENCRYPTION_KEK;
    expect(() => new EnvelopeEncryptionService()).toThrow(/ENVELOPE_ENCRYPTION_KEK/);
    process.env.ENVELOPE_ENCRYPTION_KEK = Buffer.alloc(32, 7).toString('base64');
  });

  it('detecta adulteração do ciphertext — decrypt lança em vez de retornar dado corrompido', () => {
    const service = new EnvelopeEncryptionService();
    const payload = service.encrypt('12345678901');
    const tampered = { ...payload, ciphertext: Buffer.from('lixo-adulterado').toString('base64') };
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('KEK errada não decifra o payload de uma KEK diferente', () => {
    const serviceA = new EnvelopeEncryptionService();
    const payload = serviceA.encrypt('12345678901');
    process.env.ENVELOPE_ENCRYPTION_KEK = Buffer.alloc(32, 9).toString('base64');
    const serviceB = new EnvelopeEncryptionService();
    expect(() => serviceB.decrypt(payload)).toThrow();
  });
});
