import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsInt, IsString } from 'class-validator';
import { Request } from 'express';
import { Pool, PoolClient } from 'pg';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { TenantContext } from '../database/tenant-context';
import { AssessmentService } from '../assessment/assessment.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';

interface RequestWithCandidate extends Request {
  personId: string;
}

class ResponderBlocoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  itemIds!: string[];

  @IsString()
  @IsNotEmpty()
  maisId!: string;

  @IsString()
  @IsNotEmpty()
  menosId!: string;

  @IsOptional()
  @IsInt()
  duracaoMs?: number;
}

// Nunca expõe theta/seTheta/escoreBruto/calibracaoVersao em nenhuma
// resposta -- ver Global Constraints do plano ("o candidato nunca vê
// nenhum campo de escoragem"). GET e POST devolvem só o necessário para
// navegar os blocos: bloco atual, seus 2 itens, progresso, e um booleano
// de conclusão.
@Controller('v1/candidate/applications/:applicationId/assessment')
@UseGuards(CandidateAuthGuard)
export class CandidateAssessmentController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly pool: Pool,
    private readonly assessmentService: AssessmentService,
    private readonly encryption: EnvelopeEncryptionService,
  ) {
    this.tenantContext = new TenantContext(this.pool);
  }

  // Mesmo padrão de CandidateApplicationController.resolveOwnedApplicationTenant:
  // candidate_application_summary é a única superfície global segura para
  // resolver "esta application_id é minha, e pertence a qual tenant" sem
  // tenant conhecido a priori. Zero linhas sempre vira 404, nunca 403.
  private async resolveOwnedApplicationTenant(personId: string, applicationId: string): Promise<string> {
    const result = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM candidate_application_summary WHERE application_id = $1 AND person_id = $2`,
      [applicationId, personId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Candidatura ${applicationId} não encontrada`);
    }
    return result.rows[0].tenant_id;
  }

  private async resolveAssessmentApplicationId(
    client: PoolClient,
    tenantId: string,
    applicationId: string,
  ): Promise<{ id: string; status: string }> {
    const result = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM assessment_application
        WHERE tenant_id = $1 AND application_id = $2
        ORDER BY convidado_em DESC LIMIT 1`,
      [tenantId, applicationId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Nenhum assessment encontrado para a candidatura ${applicationId}`);
    }
    return result.rows[0];
  }

  @Get()
  async obterBlocoAtual(@Req() req: RequestWithCandidate, @Param('applicationId') applicationId: string) {
    const tenantId = await this.resolveOwnedApplicationTenant(req.personId, applicationId);
    return this.tenantContext.run(tenantId, async (client) => {
      const assessment = await this.resolveAssessmentApplicationId(client, tenantId, applicationId);
      if (assessment.status !== 'iniciado') {
        return { concluido: true };
      }

      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM block b
           JOIN assessment_application aa ON aa.instrument_version_id = b.instrument_version_id
          WHERE aa.id = $1`,
        [assessment.id],
      );
      const respondidos = await client.query<{ n: number }>(
        `SELECT count(DISTINCT block_id)::int AS n FROM item_response WHERE assessment_application_id = $1`,
        [assessment.id],
      );

      const blocoAtual = await client.query<{
        block_id: string;
        item_id: string;
        enunciado: string;
      }>(
        `SELECT b.id AS block_id, i.id AS item_id, i.enunciado
           FROM block b
           JOIN assessment_application aa ON aa.instrument_version_id = b.instrument_version_id
           JOIN block_item bi ON bi.block_id = b.id
           JOIN item i ON i.id = bi.item_id
          WHERE aa.id = $1
            AND b.id NOT IN (
              SELECT DISTINCT block_id FROM item_response WHERE assessment_application_id = $1
            )
          ORDER BY b.ordem ASC, bi.posicao ASC
          LIMIT 2`,
        [assessment.id],
      );

      if (blocoAtual.rows.length === 0) {
        return { concluido: true };
      }

      return {
        blockId: blocoAtual.rows[0].block_id,
        itens: blocoAtual.rows.map((row) => ({ itemId: row.item_id, texto: row.enunciado })),
        progresso: { atual: respondidos.rows[0].n, total: total.rows[0].n },
      };
    });
  }

  @Post('blocks/:blockId/answer')
  async responder(
    @Req() req: RequestWithCandidate,
    @Param('applicationId') applicationId: string,
    @Param('blockId') blockId: string,
    @Body() dto: ResponderBlocoDto,
  ) {
    const tenantId = await this.resolveOwnedApplicationTenant(req.personId, applicationId);
    return this.tenantContext.run(tenantId, async (client) => {
      const assessment = await this.resolveAssessmentApplicationId(client, tenantId, applicationId);

      await this.assessmentService.responderBloco(client, this.encryption, {
        assessmentApplicationId: assessment.id,
        blockId,
        itemIds: dto.itemIds,
        maisId: dto.maisId,
        menosId: dto.menosId,
        duracaoMs: dto.duracaoMs,
      });

      try {
        await this.assessmentService.concluir(client, this.encryption, assessment.id);
        return { concluido: true };
      } catch {
        // AssessmentService.concluir lança ConflictException quando ainda
        // faltam blocos ("incompleto: X de Y") -- esperado na maioria das
        // respostas, não é um erro real desta rota. Só a última resposta
        // (que completa os 20 blocos) faz concluir ter sucesso.
        return { concluido: false };
      }
    });
  }
}
