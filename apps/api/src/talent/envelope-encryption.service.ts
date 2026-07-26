import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
}

const ALGORITHM = 'aes-256-gcm';
const KEK_BYTES = 32;
const IV_BYTES = 12; // 96 bits — recomendado pelo NIST para GCM

@Injectable()
export class EnvelopeEncryptionService {
  private readonly kek: Buffer;

  constructor() {
    const kekBase64 = process.env.ENVELOPE_ENCRYPTION_KEK;
    if (!kekBase64) {
      throw new Error(
        'ENVELOPE_ENCRYPTION_KEK ausente — EnvelopeEncryptionService nunca deve instanciar sem a chave mestra de envelope',
      );
    }
    const kek = Buffer.from(kekBase64, 'base64');
    if (kek.length !== KEK_BYTES) {
      throw new Error(
        `ENVELOPE_ENCRYPTION_KEK deve decodificar para ${KEK_BYTES} bytes (256 bits), recebeu ${kek.length}`,
      );
    }
    this.kek = kek;
  }

  encrypt(plaintext: string): EncryptedPayload {
    // DEK nova a cada chamada — nunca reaproveitada entre registros.
    const dek = randomBytes(32);
    const dataIv = randomBytes(IV_BYTES);
    const dataCipher = createCipheriv(ALGORITHM, dek, dataIv);
    const ciphertext = Buffer.concat([dataCipher.update(plaintext, 'utf8'), dataCipher.final()]);
    const authTag = dataCipher.getAuthTag();

    // A DEK é cifrada ("wrapped") com a KEK mestra — nunca persistida em claro.
    const wrapIv = randomBytes(IV_BYTES);
    const wrapCipher = createCipheriv(ALGORITHM, this.kek, wrapIv);
    const wrappedDekCiphertext = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapAuthTag = wrapCipher.getAuthTag();
    // Empacota wrapIv + wrapAuthTag + wrappedDekCiphertext num único campo
    // base64, para não precisar de colunas extras só para o wrapping da DEK.
    const wrappedDek = Buffer.concat([wrapIv, wrapAuthTag, wrappedDekCiphertext]).toString('base64');

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: dataIv.toString('base64'),
      authTag: authTag.toString('base64'),
      wrappedDek,
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const wrappedDekBuf = Buffer.from(payload.wrappedDek, 'base64');
    const wrapIv = wrappedDekBuf.subarray(0, IV_BYTES);
    const wrapAuthTag = wrappedDekBuf.subarray(IV_BYTES, IV_BYTES + 16);
    const wrappedDekCiphertext = wrappedDekBuf.subarray(IV_BYTES + 16);

    const unwrapCipher = createDecipheriv(ALGORITHM, this.kek, wrapIv);
    unwrapCipher.setAuthTag(wrapAuthTag);
    const dek = Buffer.concat([unwrapCipher.update(wrappedDekCiphertext), unwrapCipher.final()]);

    const dataDecipher = createDecipheriv(ALGORITHM, dek, Buffer.from(payload.iv, 'base64'));
    dataDecipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([
      dataDecipher.update(Buffer.from(payload.ciphertext, 'base64')),
      dataDecipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
