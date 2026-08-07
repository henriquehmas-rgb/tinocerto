// apps/api/src/platform-api/laudo-psicologico-access.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CerbosService } from '../authz/cerbos.service';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant-context';
import { RequestWithApiKeyContext } from './api-key.guard';
import { PlatformApiProblem } from './platform-api-problem';
import { ServiceAccountCrpLinkService } from './service-account-crp-link.service';

interface RequestWithParams extends RequestWithApiKeyContext {
  params: Record<string, string>;
}

// Guard dedicado a UMA rota (GET /v1/assessment-results/:id/psych-report)
// -- não é uma extensão do CerbosGuard genérico usado por todo o resto do
// sistema (design spec, decisão 10). Chama CerbosService.check() direto
// contra a MESMA policy real (resource_laudo_psicologico.yaml) que já
// protege o laudo desde a Fase 0 -- nunca reavalia a decisão por conta
// própria, só escolhe o `type` RFC 9457 mais preciso DEPOIS que o Cerbos
// já negou, usando os mesmos fatos que já mandou pra ele.
@Injectable()
export class LaudoPsicologicoAccessGuard implements CanActivate {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly linkService: ServiceAccountCrpLinkService,
    private readonly cerbosService: CerbosService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithParams>();

    const crpAttrs = await this.tenantContext.run(req.tenantId, (client) =>
      this.linkService.resolveCrpAttrs(client, req.userId),
    );

    const decision = await this.cerbosService.check(
      {
        id: req.userId,
        roles: req.userRoles,
        attr: { tenant_id: req.tenantId, scopes: req.apiKeyScopes ?? [], ...(crpAttrs ?? {}) },
      },
      { kind: 'laudo_psicologico', id: req.params.id ?? 'new', attr: { tenant_id: req.tenantId } },
      ['read'],
    );

    if (decision.read) {
      return true;
    }

    // Cerbos já decidiu NEGAR. Daqui pra baixo só escolhe o `type` RFC
    // 9457 mais preciso -- nunca concede o que o Cerbos negou.
    if (!(req.apiKeyScopes ?? []).includes('psych:report.read')) {
      throw new PlatformApiProblem(
        403,
        'escopo-insuficiente',
        'Escopo insuficiente',
        'O escopo psych:report.read exige service account vinculado a um CRP ativo.',
        { required_scope: 'psych:report.read' },
      );
    }

    throw new PlatformApiProblem(
      403,
      'crp-nao-vinculado-ou-inativo',
      'CRP não vinculado ou inativo',
      'Este service account não está vinculado a um psicólogo com CRP ativo.',
    );
  }
}
