import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { PlatformApiProblem, PROBLEM_BASE_URL } from './platform-api-problem';

// Aplicado só nos controllers da Plataforma API (@UseFilters local, NUNCA
// app.useGlobalFilters) -- rotas de sessão das Fases 0-3 mantêm sua
// própria convenção de erro intocada. Ver design spec §4/Riscos: o `403`
// de escopo insuficiente vem do CerbosGuard (compartilhado com todo o
// resto do sistema) como ForbiddenException genérica, então cai no ramo
// HttpException abaixo com type=erro-http, não escopo-insuficiente --
// divergência documentada, não escondida.
@Catch()
export class PlatformApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = randomUUID();

    if (exception instanceof PlatformApiProblem) {
      const body = exception.getProblemBody();
      res.status(body.status).json({
        type: `${PROBLEM_BASE_URL}/${body.typeSlug}`,
        title: body.title,
        status: body.status,
        detail: body.detail,
        instance: req.originalUrl,
        trace_id: traceId,
        ...body.extensions,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({
        type: `${PROBLEM_BASE_URL}/erro-http`,
        title: exception.name,
        status,
        detail: exception.message,
        instance: req.originalUrl,
        trace_id: traceId,
      });
      return;
    }

    // Nunca vaza stack/mensagem interna na resposta pública.
    res.status(500).json({
      type: `${PROBLEM_BASE_URL}/erro-interno`,
      title: 'Erro interno',
      status: 500,
      detail: 'Ocorreu um erro inesperado ao processar a requisição.',
      instance: req.originalUrl,
      trace_id: traceId,
    });
  }
}
