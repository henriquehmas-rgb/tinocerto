import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { AdverseImpactSnapshotService } from './adverse-impact-snapshot.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// Achado de revisão adversarial da Task 6: `[]` (não 404) para vaga sem
// snapshot só é seguro porque quem de fato impede vazamento cross-tenant
// aqui é o RLS FORCE+RESTRICTIVE de adverse_impact_snapshot (via
// TenantContext.run), não o Cerbos. `CerbosGuard.canActivate` monta
// `resource.attr.tenant_id` a partir do próprio `req.tenantId` do
// requisitante -- nunca de um lookup real do tenant dono do `:id` da rota
// (mesmo achado já registrado em `application.controller.ts`, Task 12 da
// Fase 2a) -- então a regra `bloqueio-tenant-diferente` do Cerbos nunca
// dispara para este recurso. Se o caminho de leitura algum dia deixar de
// passar por `TenantContext.run`, essa proteção desaparece silenciosamente
// -- registrado aqui para não ser confundido com "Cerbos já bloqueia".
@Controller('v1/jobs')
@UseGuards(CerbosGuard)
export class AdverseImpactController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly snapshotService: AdverseImpactSnapshotService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/adverse-impact')
  @CerbosCheck('job', 'read')
  async porVaga(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.snapshotService.listarPorVaga(client, id));
  }
}
