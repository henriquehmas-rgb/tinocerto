import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { EncryptedPayload, EnvelopeEncryptionService } from '../talent/envelope-encryption.service';

const NUMERO_BACKUP_CODES = 10;
const ISSUER = 'Tinocerto';

@Injectable()
export class MfaService {
  constructor(private readonly envelopeEncryption: EnvelopeEncryptionService) {}

  async gerarSetup(): Promise<{ secretCifrado: EncryptedPayload; qrCodeDataUri: string }> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri('staff', ISSUER, secret);
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUrl);
    const secretCifrado = this.envelopeEncryption.encrypt(secret);
    return { secretCifrado, qrCodeDataUri };
  }

  private decifrarSecret(secretCifrado: EncryptedPayload): string {
    return this.envelopeEncryption.decrypt(secretCifrado);
  }

  async verificarCodigo(secretCifrado: EncryptedPayload, codigo: string): Promise<boolean> {
    const secret = this.decifrarSecret(secretCifrado);
    return authenticator.check(codigo, secret);
  }

  gerarBackupCodes(): { codigos: string[]; cifrados: EncryptedPayload[] } {
    const codigos = Array.from({ length: NUMERO_BACKUP_CODES }, () => randomBytes(5).toString('hex'));
    const cifrados = codigos.map((c) => this.envelopeEncryption.encrypt(c));
    return { codigos, cifrados };
  }

  verificarBackupCode(
    cifrados: EncryptedPayload[],
    codigoApresentado: string,
  ): { valido: boolean; restantes: EncryptedPayload[] } {
    const index = cifrados.findIndex((c) => this.envelopeEncryption.decrypt(c) === codigoApresentado);
    if (index === -1) {
      return { valido: false, restantes: cifrados };
    }
    const restantes = [...cifrados.slice(0, index), ...cifrados.slice(index + 1)];
    return { valido: true, restantes };
  }
}
