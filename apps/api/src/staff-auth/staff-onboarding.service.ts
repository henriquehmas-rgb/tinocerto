// apps/api/src/staff-auth/staff-onboarding.service.ts
import { randomUUID } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { TenantContext } from '../database/tenant-context';
import { generateSeoSlug } from '../hiring/seo-slug';
import { PasswordService } from './password.service';

export interface OnboardInput {
  nomeEmpresa: string;
  cnpj: string;
  emailAdmin: string;
  senhaAdmin: string;
}

// Mesmo padrão usado em src/hiring/offer.service.ts e
// src/hiring/application-started-work.service.ts: checa o code + constraint
// específicos do erro do pg em vez de deixar o 23505 cru vazar pro caller.
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint?: unknown }).constraint === constraintName
  );
}

@Injectable()
export class StaffOnboardingService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly passwordService: PasswordService,
  ) {}

  // Gera o tenantId em código (não deixa o DEFAULT gen_random_uuid() da
  // coluna decidir) e abre TenantContext.run JÁ com esse id -- é isto que
  // faz o WITH CHECK da RESTRICTIVE policy de `tenant` (id = app.tenant_id)
  // bater no INSERT: quando o INSERT roda, app.tenant_id já está setado
  // para o MESMO valor que estamos prestes a gravar como id da linha nova
  // (ver comentário completo na migration identity_0009, Task 1).
  async onboard(input: OnboardInput): Promise<{ tenantId: string; userId: string }> {
    const tenantId = randomUUID();
    // `tenant.slug` é NOT NULL e globalmente único (uq_tenant_slug), sem
    // DEFAULT no schema -- reaproveita o mesmo slugify usado para job.seo_slug
    // (src/hiring/seo-slug.ts), desambiguado pelo CNPJ para evitar colisão
    // entre empresas com nome parecido.
    const slug = generateSeoSlug(input.nomeEmpresa, input.cnpj);

    return this.tenantContext.run(tenantId, async (client) => {
      const cnpjExistente = await client.query('SELECT 1 FROM tenant WHERE cnpj = $1', [input.cnpj]);
      if (cnpjExistente.rows.length > 0) {
        throw new ConflictException('Este CNPJ já tem um tenant cadastrado');
      }

      // O SELECT acima não basta sozinho: duas chamadas concorrentes de
      // onboard() com o mesmo CNPJ (double-click no formulário público de
      // self-service, ou retry de cliente instável) podem ambas passar pelo
      // pre-check antes de qualquer uma commitar. Nesse caso o Postgres
      // serializa no próprio INSERT -- a segunda transação bloqueia até a
      // primeira commitar/dar rollback e então recebe 23505 na
      // tenant_cnpj_key. Sem este catch, esse erro cru do pg vazaria pro
      // caller em vez do ConflictException que o pre-check já usa.
      try {
        await client.query(`INSERT INTO tenant (id, razao_social, cnpj, slug) VALUES ($1, $2, $3, $4)`, [
          tenantId,
          input.nomeEmpresa,
          input.cnpj,
          slug,
        ]);
      } catch (err) {
        if (isUniqueViolation(err, 'tenant_cnpj_key')) {
          throw new ConflictException('Este CNPJ já tem um tenant cadastrado');
        }
        throw err;
      }

      const senhaHash = await this.passwordService.hash(input.senhaAdmin);
      // Achado C3 da revisão final: `user_account` só tinha
      // `UNIQUE (tenant_id, email)` (identity_0003) -- único POR TENANT, não
      // globalmente. O mesmo e-mail virando admin_tenant de vários tenants
      // deixava `resolve_staff_login_by_email` (SECURITY DEFINER, sem
      // `LIMIT`/`ORDER BY`) devolver uma linha arbitrária, tornando login
      // não-determinístico. `uq_user_account_email_global` (identity_0014)
      // fecha isso na origem -- mesmo raciocínio de pre-check + catch de
      // 23505 já usado acima para `tenant_cnpj_key`, mas aqui sem pre-check
      // separado (não há necessidade de reduzir a corrida com uma consulta
      // antes -- a única fonte de verdade é o índice único em si).
      let userId: string;
      try {
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email, senha_hash) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, input.emailAdmin, senhaHash],
        );
        userId = userResult.rows[0].id;
      } catch (err) {
        if (isUniqueViolation(err, 'uq_user_account_email_global')) {
          throw new ConflictException('Este e-mail já está cadastrado em outra conta');
        }
        throw err;
      }

      const roleResult = await client.query<{ id: string }>(`SELECT id FROM role WHERE nome = 'admin_tenant' AND tenant_id IS NULL`);
      // scope_path 'matriz' é a convenção de escopo raiz usada para o
      // admin_tenant (ver src/platform-api/webhooks/__tests__/webhook-endpoint.controller.spec.ts) --
      // NÃO é 'raiz' como no exemplo original do brief.
      await client.query(
        `INSERT INTO role_assignment (user_id, tenant_id, role_id, scope_path) VALUES ($1, $2, $3, 'matriz')`,
        [userId, tenantId, roleResult.rows[0].id],
      );

      return { tenantId, userId };
    });
  }
}
