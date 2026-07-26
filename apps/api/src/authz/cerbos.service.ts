import { Injectable } from '@nestjs/common';
import { HTTP } from '@cerbos/http';

/**
 * tenant_id é obrigatório em TODO attr (principal e resource).
 *
 * Isso é intencional (achado N3 da revisão adversarial): a policy do
 * Cerbos precisa comparar tenant do principal com tenant do resource para
 * evitar vazamento entre tenants. Tornar o campo obrigatório aqui força o
 * TypeScript a barrar, em tempo de compilação, qualquer chamador futuro que
 * esqueça de fornecer o tenant_id.
 */
export interface CerbosPrincipalAttr {
  tenant_id: string;
  [key: string]: unknown;
}

export interface CerbosResourceAttr {
  tenant_id: string;
  [key: string]: unknown;
}

export interface CerbosPrincipal {
  id: string;
  roles: string[];
  attr: CerbosPrincipalAttr;
}

export interface CerbosResource {
  kind: string;
  id: string;
  attr: CerbosResourceAttr;
}

@Injectable()
export class CerbosService {
  private readonly client: HTTP;

  constructor(baseUrl: string) {
    this.client = new HTTP(baseUrl);
  }

  async check(
    principal: CerbosPrincipal,
    resource: CerbosResource,
    actions: string[],
  ): Promise<Record<string, boolean>> {
    const decision = await this.client.checkResource({
      principal: {
        id: principal.id,
        roles: principal.roles,
        attr: principal.attr as Record<string, any>,
      },
      resource: {
        kind: resource.kind,
        id: resource.id,
        attr: resource.attr as Record<string, any>,
      },
      actions,
    });

    return Object.fromEntries(actions.map((a) => [a, decision.isAllowed(a) ?? false]));
  }
}
