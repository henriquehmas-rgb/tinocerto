import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { setTenantSpanAttribute } from '../observability/span-attributes';
import { StaffJwtService } from '../staff-auth/staff-jwt.service';

// TenantResolutionMiddleware exige um JWT de staff verificado (Task 8,
// autenticação de staff/onboarding/MFA) -- substitui o placeholder de
// headers de confiança (x-tenant-id/x-user-id/x-user-roles, sem verificação
// de assinatura) da Fase 0, documentado no próprio código como dívida
// técnica aceita até a autenticação real de login chegar. Contrato de
// saída (req.tenantId/req.userId/req.userRoles) idêntico ao anterior --
// nenhum controller de Fase 1-4 precisa mudar.
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly staffJwtService: StaffJwtService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token ausente');
    }

    let payload;
    try {
      payload = this.staffJwtService.verify(authHeader.slice('Bearer '.length));
    } catch {
      // Nunca deixa jwt.verify vazar seu próprio erro (JsonWebTokenError/
      // TokenExpiredError) -- sem HttpException, o Nest devolveria 500 em
      // vez de 401 (não há filtro global de exceções que traduza isso).
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).tenantId = payload.tenantId;
    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).userId = payload.userId;
    (req as Request & { tenantId: string; userId: string; userRoles: string[] }).userRoles = payload.roles;
    setTenantSpanAttribute(payload.tenantId);
    next();
  }
}
