import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';

interface RequestWithTenant extends Request {
  tenantId: string;
}

@Injectable()
export class PublicTenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly pool: Pool) {}

  async use(req: RequestWithTenant, _res: Response, next: NextFunction): Promise<void> {
    const slug = req.params['tenantSlug'];
    // Não faz `SELECT id FROM tenant WHERE slug = $1` diretamente: em
    // produção este pool conecta como app_runtime (DatabaseService, via
    // o provider de public.module.ts), que nunca tem app.tenant_id
    // setado neste ponto -- é justamente o que este middleware existe
    // para descobrir. A policy RESTRICTIVE tenant_isolation em `tenant`
    // (identity_0002__tenant.sql) exige `id = current_setting('app.tenant_id', true)::uuid`,
    // que com a sessão sem tenant setado vira `id = NULL`, sempre falsa
    // -- a query direta devolveria 0 linhas pra QUALQUER slug, mesmo de
    // tenant real e ativo. `resolve_tenant_id_by_slug` (migration
    // public_0002) é uma function SECURITY DEFINER estreita que só
    // expõe o id, contornando essa trava circular sem abrir as outras
    // colunas de tenant a um visitante anônimo.
    const result = await this.pool.query<{ id: string | null }>(`SELECT resolve_tenant_id_by_slug($1) AS id`, [
      slug,
    ]);
    const tenantId = result.rows[0]?.id;
    if (!tenantId) {
      throw new NotFoundException('Página não encontrada');
    }
    req.tenantId = tenantId;
    next();
  }
}
