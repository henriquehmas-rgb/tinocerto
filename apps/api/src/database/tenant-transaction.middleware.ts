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

// Mesmo padrão de placeholder do tenant acima, agora para identidade de
// usuário -- ver nota da Task 6 da Fase 1a: dívida técnica já aceita e
// documentada, trocada por autenticação real numa fase futura de login,
// sem exigir reescrita de controller (todos passam por req.userId).
function extractUserFromRequest(req: Request): { userId: string; userRoles: string[] } {
  const userIdHeader = req.header('x-user-id');
  const rolesHeader = req.header('x-user-roles');
  if (!userIdHeader) {
    throw new UnauthorizedException('x-user-id ausente');
  }
  if (!rolesHeader) {
    throw new UnauthorizedException('x-user-roles ausente');
  }
  return { userId: userIdHeader, userRoles: rolesHeader.split(',').map((r) => r.trim()).filter(Boolean) };
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = extractTenantIdFromRequest(req);
    const { userId, userRoles } = extractUserFromRequest(req);
    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).tenantId = tenantId;
    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).userId = userId;
    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).userRoles = userRoles;
    setTenantSpanAttribute(tenantId);
    next();
  }
}
