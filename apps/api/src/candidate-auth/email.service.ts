import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    // Stub deliberado -- dívida técnica documentada (Global Constraints
    // desta fase). Loga em vez de enviar de verdade; trocar por um
    // provedor real (SES, Postmark, etc.) é uma mudança isolada nesta
    // classe, nenhum chamador precisa mudar.
    this.logger.log(`[EMAIL STUB] Para: ${to} | Assunto: ${subject} | Corpo: ${body}`);
  }
}
