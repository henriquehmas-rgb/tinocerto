// apps/api/src/platform-api/service-account-crp-link.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CrpAttrs {
  crp_ativo: boolean;
  crp_numero: string;
  crp_uf: string;
}

@Injectable()
export class ServiceAccountCrpLinkService {
  async link(
    client: PoolClient,
    input: { tenantId: string; serviceAccountId: string; userId: string; vinculadoPor: string },
  ): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO service_account_crp_link (tenant_id, service_account_id, user_id, vinculado_por)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.serviceAccountId, input.userId, input.vinculadoPor],
    );
    return { id: result.rows[0].id };
  }

  async unlink(client: PoolClient, input: { tenantId: string; serviceAccountId: string }): Promise<void> {
    await client.query(
      `DELETE FROM service_account_crp_link WHERE tenant_id = $1 AND service_account_id = $2`,
      [input.tenantId, input.serviceAccountId],
    );
  }

  // null = sem vínculo. Com vínculo, SEMPRE devolve os 3 campos --
  // inclusive crp_ativo: false -- nunca omite por causa do valor. É a
  // regra DENY já existente em resource_laudo_psicologico.yaml quem decide
  // se crp_ativo=false bloqueia; este serviço só relata o que está
  // gravado, sem julgar.
  async resolveCrpAttrs(client: PoolClient, serviceAccountId: string): Promise<CrpAttrs | null> {
    const result = await client.query<{ crp_ativo: boolean; crp_numero: string; crp_uf: string }>(
      `SELECT pc.crp_ativo, pc.crp_numero, pc.crp_uf
         FROM service_account_crp_link l
         JOIN psicologo_credencial pc ON pc.user_id = l.user_id AND pc.tenant_id = l.tenant_id
        WHERE l.service_account_id = $1`,
      [serviceAccountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { crp_ativo: row.crp_ativo, crp_numero: row.crp_numero, crp_uf: row.crp_uf };
  }
}
