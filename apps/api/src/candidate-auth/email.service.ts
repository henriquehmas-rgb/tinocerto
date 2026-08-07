import { Injectable, Logger } from '@nestjs/common';

// Achado da revisão consolidada pós-Fase 4: o token de redefinição de
// senha (e qualquer outro token de posse -- verificação de e-mail
// futura, etc.) trafegava em texto claro no log deste stub, que hoje é
// o ÚNICO canal de entrega real (nenhum provedor de e-mail de verdade
// foi plugado ainda). Logs tipicamente têm uma superfície de acesso
// maior e retenção mais longa que o Postgres de produção (agregadores
// de terceiro, `docker logs`, observabilidade) -- expor o token ali
// permite sequestro de conta sem credencial nenhuma dentro da janela
// de validade do token. redactTokens() mascara o VALOR de qualquer
// query param `token=...` antes de logar, sem exigir que cada chamador
// se lembre de redigir manualmente.
function redactTokens(texto: string): string {
  return texto.replace(/([?&]token=)[^&\s]+/gi, '$1***REDACTED***');
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    // Stub deliberado -- dívida técnica documentada (Global Constraints
    // desta fase). Loga em vez de enviar de verdade; trocar por um
    // provedor real (SES, Postmark, etc.) é uma mudança isolada nesta
    // classe, nenhum chamador precisa mudar.
    this.logger.log(`[EMAIL STUB] Para: ${to} | Assunto: ${subject} | Corpo: ${redactTokens(body)}`);
  }
}
