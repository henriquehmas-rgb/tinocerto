// apps/api/src/platform-api/psych-report.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RESULT_GRANT_LIVE_EXISTS } from '../talent/result-grant-predicate';

export interface PsychReportRaw {
  assessmentResultId: string;
  theta: Record<string, number>;
  seTheta: Record<string, number>;
  escoreBruto: Record<string, number> | null;
  protocoloConfianca: number | null;
  calibracaoVersao: string | null;
}

// Lê os campos BRUTOS de assessment_result -- nunca passa pelo linter de
// vocabulário clínico nem pela camada de rotulagem de ReportService (que
// são específicos do Trilho A narrativo). Este é o dado mais sensível e
// menos processado que o sistema realmente possui hoje: o Trilho B
// (SATEPSI, único que produziria uma narrativa clínica de verdade) está
// dormente desde a Fase 2 (design spec, decisão 14) -- inventar uma
// narrativa clínica aqui seria o "contrato fictício" que o roadmap
// (07-roadmap-por-fases.md §10) nomeia como pior tipo de quebra de
// confiança. Quando o Trilho B for ativado, este payload se estende
// (aditivo); o gate de autorização (Task 5) não muda.
@Injectable()
export class PsychReportService {
  async obterIntegra(client: PoolClient, assessmentResultId: string): Promise<PsychReportRaw> {
    const { rows } = await client.query<{
      id: string;
      theta: Record<string, number> | null;
      se_theta: Record<string, number> | null;
      escore_bruto: Record<string, number> | null;
      protocolo_confianca: string | null;
      calibracao_versao: string | null;
    }>(
      `SELECT r.id, r.theta, r.se_theta, r.escore_bruto, r.protocolo_confianca, r.calibracao_versao
         FROM assessment_result r
        WHERE r.id = $1
          AND ${RESULT_GRANT_LIVE_EXISTS}`,
      [assessmentResultId],
    );
    if (rows.length === 0) {
      // Mesma resposta para "não existe" e "existe mas sem grant vivo
      // para este tenant" -- mesmo padrão anti-oráculo de
      // ReportService.gerar.
      throw new NotFoundException('Resultado não encontrado para este assessment_result');
    }
    const row = rows[0];
    if (row.theta === null || Object.keys(row.theta).length === 0) {
      throw new NotFoundException('assessment_result ainda não foi escorado -- não há laudo a servir');
    }
    return {
      assessmentResultId: row.id,
      theta: row.theta,
      seTheta: row.se_theta ?? {},
      escoreBruto: row.escore_bruto,
      protocoloConfianca: row.protocolo_confianca === null ? null : Number(row.protocolo_confianca),
      calibracaoVersao: row.calibracao_versao,
    };
  }
}
