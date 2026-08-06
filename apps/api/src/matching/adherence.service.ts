import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { calcularScoreAderencia, ScoreAderencia } from './adherence-scoring';
import { PersonService } from '../talent/person.service';

// Allowlist estrutural (não política de runtime): esta query só pode
// selecionar job.habilidades_exigidas (feature de decisão) e
// application.person_id (chave de junção, usada só para localizar o
// perfil via PersonService -- nunca exposta como feature). Testada em
// __tests__/adherence.service.spec.ts. A leitura de person_profile em si
// passa por PersonService.habilidades, único ponto de leitura daquela
// tabela no sistema (ver talent/person.service.ts).
export const QUERY_ADERENCIA_POR_CANDIDATURA = `
  SELECT j.habilidades_exigidas, a.person_id
  FROM application a
  JOIN job j ON j.id = a.job_id
  WHERE a.id = $1
`;

@Injectable()
export class AdherenceService {
  constructor(private readonly personService: PersonService) {}

  /**
   * `null` quando a candidatura não existe OU não é visível para o tenant
   * corrente -- RLS de `application`/`job` (FORCE+RESTRICTIVE) filtra a
   * query por `app.tenant_id` antes de qualquer linha chegar aqui, mesmo
   * padrão de ApplicationService.findByIdWithPersonView.
   */
  async porCandidatura(client: PoolClient, applicationId: string): Promise<ScoreAderencia | null> {
    const result = await client.query<{
      habilidades_exigidas: string[];
      person_id: string;
    }>(QUERY_ADERENCIA_POR_CANDIDATURA, [applicationId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const habilidadesCandidato = await this.personService.habilidades(client, row.person_id);
    return calcularScoreAderencia(row.habilidades_exigidas, habilidadesCandidato);
  }
}
