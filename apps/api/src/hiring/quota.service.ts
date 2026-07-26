import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { calculatePcdQuotaPercent, calculateAprendizQuotaRange } from './compliance/quota-calculator';

export interface QuotaStatus {
  totalEmpregados: number;
  pcdPercentMinimo: number;
  pcdVagasMinimo: number;
  aprendizRange: { min: number; max: number };
}

@Injectable()
export class QuotaService {
  async getQuotaStatus(client: PoolClient, tenantId: string): Promise<QuotaStatus> {
    const result = await client.query<{ total_empregados: number }>(
      `SELECT total_empregados FROM tenant_quota_config WHERE tenant_id = $1`,
      [tenantId],
    );
    const totalEmpregados = result.rows[0]?.total_empregados ?? 0;
    const pcdPercentMinimo = calculatePcdQuotaPercent(totalEmpregados);
    return {
      totalEmpregados,
      pcdPercentMinimo,
      pcdVagasMinimo: Math.ceil((totalEmpregados * pcdPercentMinimo) / 100),
      aprendizRange: calculateAprendizQuotaRange(totalEmpregados),
    };
  }
}
