import { Injectable } from '@nestjs/common';
import { HTTP } from '@cerbos/http';

export interface CerbosPrincipal {
  id: string;
  roles: string[];
  attr?: Record<string, unknown>;
}

export interface CerbosResource {
  kind: string;
  id: string;
  attr?: Record<string, unknown>;
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
        attr: (principal.attr ?? {}) as Record<string, any>,
      },
      resource: {
        kind: resource.kind,
        id: resource.id,
        attr: (resource.attr ?? {}) as Record<string, any>,
      },
      actions,
    });

    return Object.fromEntries(actions.map((a) => [a, decision.isAllowed(a) ?? false]));
  }
}
