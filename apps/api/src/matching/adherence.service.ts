import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { calcularScoreAderencia, ScoreAderencia } from './adherence-scoring';

// Allowlist estrutural (não política de runtime): esta query só pode
// selecionar job.habilidades_exigidas e person_profile.habilidades.
// Testada em __tests__/adherence.service.spec.ts -- qualquer coluna nova
// aqui precisa passar por aquele teste antes de existir de verdade.
export const QUERY_ADERENCIA_POR_CANDIDATURA = `
  SELECT j.habilidades_exigidas, pp.habilidades
  FROM application a
  JOIN job j ON j.id = a.job_id
  LEFT JOIN person_profile pp ON pp.person_id = a.person_id
  WHERE a.id = $1
`;

interface HabilidadePerfil {
  nome: string;
}

@Injectable()
export class AdherenceService {
  /**
   * `null` quando a candidatura não existe OU não é visível para o tenant
   * corrente -- RLS de `application`/`job` (FORCE+RESTRICTIVE) filtra a
   * query por `app.tenant_id` antes de qualquer linha chegar aqui, mesmo
   * padrão de ApplicationService.findByIdWithPersonView.
   */
  async porCandidatura(client: PoolClient, applicationId: string): Promise<ScoreAderencia | null> {
    const result = await client.query<{
      habilidades_exigidas: string[];
      habilidades: HabilidadePerfil[] | null;
    }>(QUERY_ADERENCIA_POR_CANDIDATURA, [applicationId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const habilidadesCandidato = (row.habilidades ?? []).map((h) => h.nome);
    return calcularScoreAderencia(row.habilidades_exigidas, habilidadesCandidato);
  }
}
