import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { IdempotencyService, hashRequestBody } from './idempotency.service';
import { PlatformApiProblem } from './platform-api-problem';

interface RequestWithTenant extends Request {
  tenantId: string;
}

// Sem consumidor real de produção nesta fatia (ver Task 3 do plano / design
// spec decisão 6) -- a superfície de API key de 4a é só leitura. Construído
// e testado agora para que a primeira rota mutante futura (Fase 4c/4d) só
// precise de @UseInterceptors(IdempotencyInterceptor) + header
// Idempotency-Key, sem reabrir esta lógica.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly idempotencyService: IdempotencyService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithTenant>();
    const chave = req.header('idempotency-key');
    if (!chave) {
      return next.handle();
    }
    const hashDaRequisicao = hashRequestBody(req.body);

    return from(
      this.tenantContext.run(req.tenantId, (client) =>
        this.idempotencyService.checkOrReserve(client, { tenantId: req.tenantId, chave, hashDaRequisicao }),
      ),
    ).pipe(
      switchMap((result) => {
        if (result.status === 'conflito') {
          throw new PlatformApiProblem(
            422,
            'idempotency-key-conflict',
            'Idempotency-Key em conflito',
            'A mesma Idempotency-Key foi usada com um corpo de requisição diferente dentro da janela de 24h.',
          );
        }
        if (result.status === 'repetido') {
          return from([result.respostaSnapshot]);
        }
        return next.handle().pipe(
          switchMap((response) =>
            from(
              this.tenantContext.run(req.tenantId, (client) =>
                this.idempotencyService.store(client, {
                  tenantId: req.tenantId,
                  chave,
                  hashDaRequisicao,
                  respostaSnapshot: response,
                }),
              ),
            ).pipe(switchMap(() => from([response]))),
          ),
        );
      }),
    );
  }
}
