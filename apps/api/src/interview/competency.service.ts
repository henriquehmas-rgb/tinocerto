import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface AncoraInput {
  nivel: number;
  descricaoComportamental: string;
}

export interface CompetenciaComAncorasInput {
  nome: string;
  ancoras: AncoraInput[];
}

export interface CompetenciaSnapshot {
  competencyId: string;
  nome: string;
  ancoras: AncoraInput[];
}

@Injectable()
export class CompetencyService {
  async resolverParaSnapshot(
    client: PoolClient,
    tenantId: string,
    competencias: CompetenciaComAncorasInput[],
  ): Promise<CompetenciaSnapshot[]> {
    const snapshot: CompetenciaSnapshot[] = [];
    for (const c of competencias) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO competency (tenant_id, nome) VALUES ($1, $2)
         ON CONFLICT (tenant_id, nome) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id`,
        [tenantId, c.nome],
      );
      snapshot.push({ competencyId: result.rows[0].id, nome: c.nome, ancoras: c.ancoras });
    }
    return snapshot;
  }
}
