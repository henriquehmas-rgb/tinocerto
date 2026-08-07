// apps/api/src/platform-api/webhooks/webhook-secret-cipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

// Chave de aplicação DEDICADA -- nunca reaproveita API_KEY_HASH_PEPPER nem
// CPF_HASH_PEPPER (mesmo isolamento de segredo por domínio já registrado
// pela Fase 4a: comprometer um não deveria comprometer o outro).
function encryptionKey(): Buffer {
  const raw = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY ausente — nunca cifrar/decifrar segredo de webhook sem chave configurada');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY deve decodificar (base64) para exatamente 32 bytes (AES-256)');
  }
  return key;
}

export function encryptWebhookSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptWebhookSecret(enc: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf-8');
}

// 'whsec_' + 32 bytes de aleatoriedade em base64url -- prefixo Svix já
// fixado em 04-api-e-webhooks.md §4.
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}
