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
    const result = await this.pool.query<{ id: string }>(`SELECT id FROM tenant WHERE slug = $1`, [slug]);
    if (result.rows.length === 0) {
      throw new NotFoundException('Página não encontrada');
    }
    req.tenantId = result.rows[0].id;
    next();
  }
}
