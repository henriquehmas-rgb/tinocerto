import { Body, ConflictException, Controller, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { OfferService, OfertaJaRespondidaError, OfertaNaoEncontradaError } from './offer.service';
import { JobRecrutadorService } from './job-recrutador.service';

class DeclineOfferDto {
  @IsOptional()
  @IsString()
  motivoCodigo?: string;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/offers')
@UseGuards(CerbosGuard)
export class OfferController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly offerService: OfferService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Item 1 da onda 3 de correção pós-revisão: nenhum dos 2 handlers deste
  // controller (accept/decline) chamava JobRecrutadorService.exigirAcesso
  // -- um recrutador sem atribuição podia aceitar/recusar a oferta de
  // QUALQUER candidatura do tenant. offer não tem jobId direto na URL (só
  // :id da própria oferta), então resolve offer.id -> application_id ->
  // job_id via OfferService.buscarJobId antes de checar posse. 404 se a
  // oferta não existir OU se existir mas o recrutador não tiver acesso --
  // mesmo raciocínio de não revelar a existência do recurso, já
  // documentado em JobRecrutadorService.exigirAcesso.
  private async exigirPosseDaOferta(req: RequestWithAuthContext, offerId: string): Promise<void> {
    await this.tenantContext.run(req.tenantId, async (client) => {
      const jobId = await this.offerService.buscarJobId(client, req.tenantId, offerId);
      if (!jobId) {
        throw new NotFoundException(`Oferta ${offerId} não encontrada`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });
  }

  @Post(':id/actions/accept')
  @CerbosCheck('offer', 'accept')
  async accept(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    await this.exigirPosseDaOferta(req, id);
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.offerService.accept(client, { tenantId: req.tenantId, offerId: id, respondidoPor: req.userId }),
      );
    } catch (err) {
      throw this.translateError(id, err);
    }
  }

  @Post(':id/actions/decline')
  @CerbosCheck('offer', 'decline')
  async decline(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: DeclineOfferDto) {
    await this.exigirPosseDaOferta(req, id);
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.offerService.decline(client, {
          tenantId: req.tenantId,
          offerId: id,
          respondidoPor: req.userId,
          motivoRecusaCodigo: dto.motivoCodigo,
        }),
      );
    } catch (err) {
      throw this.translateError(id, err);
    }
  }

  private translateError(offerId: string, err: unknown): Error {
    if (err instanceof OfertaNaoEncontradaError) {
      return new NotFoundException(`Oferta ${offerId} não encontrada`);
    }
    if (err instanceof OfertaJaRespondidaError) {
      return new ConflictException(err.message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
