import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { setTenantSpanAttribute } from '../observability/span-attributes';

// Placeholder de decodificação de JWT — a Fase 0 só precisa do contrato de
// onde o tenant_id vem; a validação real de assinatura de token entra
// junto com o login (fora do escopo desta fase).
function extractTenantIdFromRequest(req: Request): string {
  const header = req.header('x-tenant-id');
  if (!header) {
    throw new UnauthorizedException('x-tenant-id ausente');
  }
  return header;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = extractTenantIdFromRequest(req);
    (req as Request & { tenantId: string }).tenantId = tenantId;
    setTenantSpanAttribute(tenantId);
    next();
  }
}
