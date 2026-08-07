import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from './api-key.service';
import { PlatformApiProblem } from './platform-api-problem';

// Única versão existente nesta fatia -- ver design spec §7. O header é
// validado (aceita/rejeita) mas não ramifica comportamento nenhum ainda.
export const CURRENT_API_VERSION = '2026-08';

export interface RequestWithApiKeyContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
  apiKeyScopes: string[];
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & Partial<RequestWithApiKeyContext>>();

    const versionHeader = req.header('x-api-version');
    if (versionHeader && versionHeader !== CURRENT_API_VERSION) {
      throw new PlatformApiProblem(
        400,
        'versao-nao-suportada',
        'Versão de API não suportada',
        `X-Api-Version "${versionHeader}" não é suportada. Versão atual: ${CURRENT_API_VERSION}.`,
      );
    }

    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new PlatformApiProblem(401, 'credenciais-invalidas', 'Credenciais ausentes', 'Cabeçalho Authorization: Bearer ausente ou malformado.');
    }

    const resolved = await this.apiKeyService.authenticate(header.slice('Bearer '.length).trim());
    if (!resolved) {
      // Mesma mensagem para chave inexistente/revogada/hash divergente --
      // não dar oráculo de enumeração de prefixo válido.
      throw new PlatformApiProblem(401, 'credenciais-invalidas', 'Credenciais inválidas', 'Chave de API inválida, revogada ou inexistente.');
    }

    req.tenantId = resolved.tenantId;
    req.userId = resolved.serviceAccountId;
    req.userRoles = ['service_account'];
    req.apiKeyScopes = resolved.escopos;
    return true;
  }
}
