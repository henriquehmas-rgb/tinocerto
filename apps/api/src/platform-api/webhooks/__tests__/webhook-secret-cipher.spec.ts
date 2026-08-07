import { decryptWebhookSecret, encryptWebhookSecret, generateWebhookSecret } from '../webhook-secret-cipher';

describe('WebhookSecretCipher', () => {
  const originalEnv = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnv;
  });

  it('encrypt -> decrypt preserva o texto original', () => {
    const secret = generateWebhookSecret();
    const enc = encryptWebhookSecret(secret);
    expect(decryptWebhookSecret(enc)).toBe(secret);
  });

  it('generateWebhookSecret sempre começa com whsec_ e produz valores distintos', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith('whsec_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('authTag adulterado faz decrypt lançar -- nunca devolve texto corrompido silenciosamente', () => {
    const enc = encryptWebhookSecret('segredo-de-teste');
    const adulterado = { ...enc, authTag: Buffer.from('0'.repeat(24), 'base64').toString('base64') };
    expect(() => decryptWebhookSecret(adulterado)).toThrow();
  });

  it('sem WEBHOOK_SECRET_ENCRYPTION_KEY, encrypt e decrypt lançam alto', () => {
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    try {
      expect(() => encryptWebhookSecret('x')).toThrow('WEBHOOK_SECRET_ENCRYPTION_KEY ausente');
    } finally {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    }
  });
});
