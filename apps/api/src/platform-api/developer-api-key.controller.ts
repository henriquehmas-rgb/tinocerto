// apps/api/src/platform-api/developer-api-key.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApiKeyService } from './api-key.service';

class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopes!: string[];
}

interface RequestWithSessionAuth extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// Rota de SESSÃO (JWT de staff verificado por TenantResolutionMiddleware --
// StaffJwtService.verify, Task 8 -- popula req.tenantId/req.userId, sem
// exclusão -- diferente de GET /v1/applications e do psych-report, que são
// para integradores externos). Um usuário logado cria chave para o PRÓPRIO
// tenant -- não dá pra criar a primeira chave com uma chave que ainda não
// existe (design spec, decisão 1). Erros seguem a convenção padrão do
// Nest, não RFC 9457 -- RFC 9457 é só para as rotas autenticadas por API
// key (mesma lógica da decisão 4 da 4a).
@Controller('v1/developer/api-keys')
@UseGuards(CerbosGuard)
export class DeveloperApiKeyController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly apiKeyService: ApiKeyService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Cada POST cria um service_account NOVO (owner_user_id = usuário
  // logado) na MESMA transação da emissão -- não há find-or-create; cada
  // chamada é uma identidade de integração nova. Rotação/revogação
  // subsequentes referenciam essa identidade pelo id da CHAVE, nunca
  // recriam o service_account (design spec, seção Arquitetura §3).
  @Post()
  @CerbosCheck('api_key', 'create')
  async create(@Req() req: RequestWithSessionAuth, @Body() dto: CreateApiKeyDto) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const sa = await client.query<{ id: string }>(
        `INSERT INTO service_account (tenant_id, nome, scopes, owner_user_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.tenantId, dto.nome, dto.scopes, req.userId],
      );
      const serviceAccountId = sa.rows[0].id;
      const issued = await this.apiKeyService.issue(client, {
        tenantId: req.tenantId,
        serviceAccountId,
        escopos: dto.scopes,
      });
      return {
        id: issued.id,
        service_account_id: serviceAccountId,
        prefixo: issued.prefixo,
        // raw_key só existe na resposta desta chamada -- nunca mais é
        // recuperável depois (mesmo contrato que Stripe/GitHub usam).
        raw_key: issued.rawKey,
        scopes: dto.scopes,
      };
    });
  }

  @Get()
  @CerbosCheck('api_key', 'read')
  async list(@Req() req: RequestWithSessionAuth) {
    const items = await this.tenantContext.run(req.tenantId, (client) =>
      this.apiKeyService.listByTenant(client, req.tenantId),
    );
    return {
      data: items.map((item) => ({
        id: item.id,
        service_account_id: item.serviceAccountId,
        nome: item.nomeServiceAccount,
        prefixo: item.prefixo,
        scopes: item.escopos,
        criado_em: item.criadoEm.toISOString(),
        revogado_em: item.revogadoEm?.toISOString() ?? null,
        expira_em: item.expiraEm?.toISOString() ?? null,
      })),
    };
  }

  @Delete(':id')
  @CerbosCheck('api_key', 'revoke')
  async revoke(@Req() req: RequestWithSessionAuth, @Param('id') id: string) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.apiKeyService.revoke(client, { tenantId: req.tenantId, apiKeyId: id }),
    );
    return { id, status: 'revogada' };
  }

  @Post(':id/actions/rotate')
  @CerbosCheck('api_key', 'rotate')
  async rotate(@Req() req: RequestWithSessionAuth, @Param('id') id: string) {
    const issued = await this.tenantContext.run(req.tenantId, (client) =>
      this.apiKeyService.rotate(client, { tenantId: req.tenantId, oldApiKeyId: id }),
    );
    return { id: issued.id, prefixo: issued.prefixo, raw_key: issued.rawKey, overlap_days: 7 };
  }
}
