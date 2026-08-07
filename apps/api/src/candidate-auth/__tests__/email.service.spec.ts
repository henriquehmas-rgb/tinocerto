import { EmailService } from '../email.service';
import { Logger } from '@nestjs/common';

describe('EmailService.send', () => {
  it('redige o valor de qualquer query param token= no corpo antes de logar', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new EmailService();

    const tokenReal = 'qcahA3Gg4x6zPFksApb8Y2M__35dFsHAugMsoR1emmQ';
    await service.send(
      'candidato@example.com',
      'Redefinição de senha',
      `Use este link para redefinir sua senha: /candidato/redefinir-senha?token=${tokenReal}`,
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const linhaLogada = logSpy.mock.calls[0][0] as string;

    // O token real nunca aparece em nenhuma chamada de log.
    expect(linhaLogada).not.toContain(tokenReal);
    // Mas o resto do contexto útil pro stub continua presente.
    expect(linhaLogada).toContain('candidato@example.com');
    expect(linhaLogada).toContain('Redefinição de senha');
    expect(linhaLogada).toContain('token=***REDACTED***');

    logSpy.mockRestore();
  });

  it('não altera corpos de e-mail sem query param token=', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new EmailService();

    await service.send('a@example.com', 'Assunto qualquer', 'Corpo sem nenhum token nele.');

    const linhaLogada = logSpy.mock.calls[0][0] as string;
    expect(linhaLogada).toContain('Corpo sem nenhum token nele.');

    logSpy.mockRestore();
  });
});
