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

export const PAPEIS_COM_ACESSO_TOTAL = ['admin_tenant', 'gestor_vaga'];

/**
 * Item 3b da onda 2 de correção pós-revisão: um UUID bem-formado mas de um
 * user_account inexistente/de outro tenant estourava a FK composta
 * fk_job_recrutador_tenant_staff (tenant_id, staff_id) -> user_account
 * (tenant_id, id) como um 23503 (foreign_key_violation) não tratado do
 * Postgres, virando 500 tanto em POST /v1/jobs (via JobService.create)
 * quanto em POST /v1/jobs/:id/actions/atribuir-recrutadores. Traduzido aqui
 * para um erro de negócio explícito, que os dois pontos de entrada
 * traduzem para 400 (erro de input do chamador, não recurso não
 * encontrado).
 */
export class RecrutadorInvalidoError extends Error {}

function isForeignKeyViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23503' &&
    (err as { constraint?: unknown }).constraint === constraintName
  );
}

@Injectable()
export class JobRecrutadorService {
  /** Substitui o conjunto completo de recrutadores atribuídos à vaga. */
  async atribuir(client: PoolClient, input: AtribuirRecrutadoresInput): Promise<void> {
    await client.query(`DELETE FROM job_recrutador WHERE job_id = $1 AND tenant_id = $2`, [
      input.jobId,
      input.tenantId,
    ]);
    try {
      for (const staffId of input.recrutadorIds) {
        await client.query(
          `INSERT INTO job_recrutador (job_id, tenant_id, staff_id) VALUES ($1, $2, $3)`,
          [input.jobId, input.tenantId, staffId],
        );
      }
    } catch (err) {
      if (isForeignKeyViolation(err, 'fk_job_recrutador_tenant_staff')) {
        throw new RecrutadorInvalidoError(
          'Um ou mais IDs de recrutador não existem ou não pertencem a este tenant',
        );
      }
      throw err;
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
