import { authenticator } from 'otplib';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { MfaService } from '../mfa.service';

describe('MfaService', () => {
  beforeAll(() => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');
  });

  const service = new MfaService(new EnvelopeEncryptionService());

  it('gera um setup cujo secret cifrado, uma vez decifrado, aceita o código TOTP real gerado a partir dele', async () => {
    const setup = await service.gerarSetup();
    expect(setup.qrCodeDataUri).toMatch(/^data:image\/png;base64,/);

    // Recupera o secret em claro só para gerar o código de teste (o próprio
    // MfaService nunca expõe isso fora do fluxo interno de verificação) --
    // decifra via o mesmo EnvelopeEncryptionService injetado no service, não
    // um novo, para bater exatamente o que gerarSetup produziu.
    const decifrarSecret = (
      service as unknown as { decifrarSecret: (s: unknown) => string }
    ).decifrarSecret.bind(service);
    const codigo = authenticator.generate(decifrarSecret(setup.secretCifrado));
    expect(await service.verificarCodigo(setup.secretCifrado, codigo)).toBe(true);
  });

  it('rejeita um código TOTP incorreto', async () => {
    const setup = await service.gerarSetup();
    expect(await service.verificarCodigo(setup.secretCifrado, '000000')).toBe(false);
  });

  it('backup code funciona uma única vez -- a segunda apresentação do mesmo código falha', () => {
    const { codigos, cifrados } = service.gerarBackupCodes();
    const primeira = service.verificarBackupCode(cifrados, codigos[0]);
    expect(primeira.valido).toBe(true);
    expect(primeira.restantes).toHaveLength(cifrados.length - 1);

    const segunda = service.verificarBackupCode(primeira.restantes, codigos[0]);
    expect(segunda.valido).toBe(false);
  });
});
