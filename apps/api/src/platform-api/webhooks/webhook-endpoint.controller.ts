// apps/api/src/platform-api/webhooks/webhook-endpoint.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, Matches } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../../database/tenant-context';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { CerbosCheck } from '../../authz/cerbos-check.decorator';
import { WebhookEndpointService } from './webhook-endpoint.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

class CreateWebhookEndpointDto {
  @IsString()
  @Matches(/^https:\/\//, { message: 'url deve começar com https://' })
  url!: string;

  @IsArray()
  @IsString({ each: true })
  eventosFiltro!: string[];
}

// Ambos os campos opcionais -- @IsOptional() é obrigatório em cada um
// (mesmo padrão de ListApplicationsQuery, Fase 4a): sem ele, class-validator
// valida @IsString()/@Matches() mesmo quando o campo vem undefined (update
// parcial só de eventosFiltro, por exemplo), rejeitando com 400 um corpo
// válido.
class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\//, { message: 'url deve começar com https://' })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventosFiltro?: string[];
}

@Controller('v1/webhook-endpoints')
@UseGuards(CerbosGuard)
export class WebhookEndpointController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly webhookEndpointService: WebhookEndpointService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('webhook_endpoint', 'create')
  create(@Req() req: RequestWithAuthContext, @Body() dto: CreateWebhookEndpointDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.webhookEndpointService.create(client, { tenantId: req.tenantId, url: dto.url, eventosFiltro: dto.eventosFiltro }),
    );
  }

  @Get()
  @CerbosCheck('webhook_endpoint', 'read')
  list(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, (client) => this.webhookEndpointService.list(client));
  }

  @Get(':id')
  @CerbosCheck('webhook_endpoint', 'read')
  get(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.webhookEndpointService.get(client, id));
  }

  @Patch(':id')
  @CerbosCheck('webhook_endpoint', 'update')
  async update(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: UpdateWebhookEndpointDto) {
    await this.tenantContext.run(req.tenantId, (client) => this.webhookEndpointService.update(client, id, dto));
    return { id };
  }

  @Post(':id/actions/deactivate')
  @CerbosCheck('webhook_endpoint', 'deactivate')
  async deactivate(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    await this.tenantContext.run(req.tenantId, (client) => this.webhookEndpointService.deactivate(client, id));
    return { id, ativo: false };
  }

  @Post(':id/actions/rotate-secret')
  @CerbosCheck('webhook_endpoint', 'rotate-secret')
  rotateSecret(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.webhookEndpointService.rotateSecret(client, id));
  }
}
