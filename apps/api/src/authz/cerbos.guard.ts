import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CerbosService } from './cerbos.service';
import { CERBOS_CHECK_KEY, CerbosCheckMetadata } from './cerbos-check.decorator';

interface RequestWithAuthContext {
  tenantId: string;
  userId: string;
  userRoles: string[];
  params: Record<string, string>;
}

@Injectable()
export class CerbosGuard implements CanActivate {
  constructor(
    private readonly cerbosService: CerbosService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<CerbosCheckMetadata | undefined>(CERBOS_CHECK_KEY, context.getHandler());
    if (!metadata) {
      // Rota sem @CerbosCheck -- passa sem checagem (ex.: health-check).
      // Todo endpoint de negócio desta fase em diante DEVE ter o decorator;
      // a ausência dele é uma escolha explícita do autor do controller, não
      // um bug deste guard.
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithAuthContext>();
    const resourceId = req.params?.id ?? 'new';

    const decision = await this.cerbosService.check(
      { id: req.userId, roles: req.userRoles, attr: { tenant_id: req.tenantId } },
      { kind: metadata.resourceKind, id: resourceId, attr: { tenant_id: req.tenantId } },
      [metadata.action],
    );

    if (!decision[metadata.action]) {
      throw new ForbiddenException(
        `Ação "${metadata.action}" não permitida em "${metadata.resourceKind}" para este usuário`,
      );
    }
    return true;
  }
}
