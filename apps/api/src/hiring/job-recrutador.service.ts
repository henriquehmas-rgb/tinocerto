import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface AtribuirRecrutadoresInput {
  tenantId: string;
  jobId: string;
  recrutadorIds: string[];
}

export interface ExigirAcessoInput {
  tenantId: string;
  jobId: string;
  userId: string;
  userRoles: string[];
}

const PAPEIS_COM_ACESSO_TOTAL = ['admin_tenant', 'gestor_vaga'];

@Injectable()
export class JobRecrutadorService {
  /** Substitui o conjunto completo de recrutadores atribuídos à vaga. */
  async atribuir(client: PoolClient, input: AtribuirRecrutadoresInput): Promise<void> {
    await client.query(`DELETE FROM job_recrutador WHERE job_id = $1 AND tenant_id = $2`, [
      input.jobId,
      input.tenantId,
    ]);
    for (const staffId of input.recrutadorIds) {
      await client.query(
        `INSERT INTO job_recrutador (job_id, tenant_id, staff_id) VALUES ($1, $2, $3)`,
        [input.jobId, input.tenantId, staffId],
      );
    }
  }

  async listarPorVaga(client: PoolClient, input: { tenantId: string; jobId: string }): Promise<string[]> {
    const result = await client.query<{ staff_id: string }>(
      `SELECT staff_id FROM job_recrutador WHERE job_id = $1 AND tenant_id = $2`,
      [input.jobId, input.tenantId],
    );
    return result.rows.map((row) => row.staff_id);
  }

  /**
   * Papéis com acesso total (admin_tenant, gestor_vaga) passam sempre.
   * Papel recrutador só passa se estiver em job_recrutador para esta vaga.
   * 404 (não 403) para não revelar a existência da vaga a quem não tem acesso --
   * mesmo raciocínio do catch de violação de FK em application.controller.ts.
   */
  async exigirAcesso(client: PoolClient, input: ExigirAcessoInput): Promise<void> {
    if (input.userRoles.some((papel) => PAPEIS_COM_ACESSO_TOTAL.includes(papel))) {
      return;
    }
    const result = await client.query(
      `SELECT 1 FROM job_recrutador WHERE job_id = $1 AND tenant_id = $2 AND staff_id = $3`,
      [input.jobId, input.tenantId, input.userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('Vaga não encontrada');
    }
  }
}
