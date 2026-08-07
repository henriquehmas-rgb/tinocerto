import { Body, ConflictException, Controller, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { OfferService, OfertaJaRespondidaError, OfertaNaoEncontradaError } from './offer.service';

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
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post(':id/actions/accept')
  @CerbosCheck('offer', 'accept')
  async accept(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
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
