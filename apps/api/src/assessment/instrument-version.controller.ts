import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { Pool } from 'pg';
import { TenantContext } from '../database/tenant-context';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// Sem @UseGuards(CerbosGuard)/@CerbosCheck de propósito: instrument_version
// é dado de referência GLOBAL (sem tenant_id, ver instrument_0001__competency.sql
// não se aplica -- instrument/instrument_version não têm RLS nenhuma), não
// há nenhum recurso por-tenant a autorizar aqui. Qualquer staff autenticado
// (TenantResolutionMiddleware já exige isso, cobre esta rota por padrão)
// pode listar as versões ativas -- mesmo raciocínio de uma rota "sem
// @CerbosCheck" já documentado no comentário de CerbosGuard.canActivate.
@Controller('v1/instrument-versions')
export class InstrumentVersionController {
  private readonly tenantContext: TenantContext;

  constructor(private readonly pool: Pool) {
    this.tenantContext = new TenantContext(this.pool);
  }

  @Get()
  async listar(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, async () => {
      const result = await this.pool.query<{ id: string; nome: string; versao: number }>(
        `SELECT iv.id, i.nome, iv.versao
           FROM instrument_version iv
           JOIN instrument i ON i.id = iv.instrument_id
          WHERE iv.ativo = true
          ORDER BY i.nome, iv.versao DESC`,
      );
      return result.rows;
    });
  }
}
