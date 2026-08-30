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

// Allowlist estrutural irmã de QUERY_ADERENCIA_POR_CANDIDATURA: para o
// funil inteiro, as habilidades exigidas são lidas UMA vez (é a mesma
// vaga para todos os candidatos), e os person_id já vêm do chamador.
export const QUERY_HABILIDADES_EXIGIDAS_DA_VAGA = `SELECT habilidades_exigidas FROM job WHERE id = $1`;

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

  /**
   * Fit de todos os candidatos de uma vaga em DUAS consultas fixas
   * (habilidades exigidas + habilidades em lote), nunca uma por candidato.
   * Mesma allowlist de features do método por candidatura: só
   * job.habilidades_exigidas e as habilidades do perfil entram na decisão.
   */
  async porCandidaturasDaVaga(
    client: PoolClient,
    input: { jobId: string; candidatos: { applicationId: string; personId: string }[] },
  ): Promise<Map<string, number | null>> {
    const scores = new Map<string, number | null>();
    if (input.candidatos.length === 0) return scores;

    const vaga = await client.query<{ habilidades_exigidas: string[] }>(QUERY_HABILIDADES_EXIGIDAS_DA_VAGA, [
      input.jobId,
    ]);
    const exigidas = vaga.rows[0]?.habilidades_exigidas ?? [];

    const personIds = [...new Set(input.candidatos.map((c) => c.personId))];
    const habilidadesPorPessoa = await this.personService.habilidadesEmLote(client, personIds);

    // A regra é por candidato, não por lote: person_profile ausente para
    // ESTA pessoa significa fit desconhecido (null) para ELA, não importa
    // se outro candidato do mesmo lote tem perfil. habilidadesEmLote só
    // devolve entrada no Map pra quem tem person_profile -- ausência da
    // chave é o sinal de "currículo nunca foi parseado", distinto de
    // "perfil existe e não bate nenhuma habilidade" (isso é 0 genuíno).
    // Tratar "sem perfil" como "perfil vazio" fabricaria um julgamento
    // sobre um candidato real que nunca foi avaliado.
    for (const candidato of input.candidatos) {
      if (!habilidadesPorPessoa.has(candidato.personId)) {
        scores.set(candidato.applicationId, null);
        continue;
      }
      const doCandidato = habilidadesPorPessoa.get(candidato.personId)!;
      scores.set(candidato.applicationId, calcularScoreAderencia(exigidas, doCandidato).scoreAderencia);
    }
    return scores;
  }
}
