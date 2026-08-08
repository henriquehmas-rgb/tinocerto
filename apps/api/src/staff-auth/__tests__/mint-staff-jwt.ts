// apps/api/src/staff-auth/__tests__/mint-staff-jwt.ts
import { StaffJwtService } from '../staff-jwt.service';

// Helper de teste -- assina um access token de staff válido usando a MESMA
// StaffJwtService de produção (mesmo algoritmo/verificação), para que os
// testes que sobem a aplicação inteira via createNestApplication() +
// fetch/supertest possam autenticar contra TenantResolutionMiddleware sem
// duplicar lógica de assinatura. `STAFF_JWT_SECRET` só recebe um valor
// default aqui se ainda não estiver setado (ex. rodando um único spec file
// isolado fora do setup global de testes).
export function mintStaffJwt(payload: { userId: string; tenantId: string; roles: string[] }): string {
  process.env.STAFF_JWT_SECRET ??= 'segredo-de-teste-nao-usar-em-producao';
  return new StaffJwtService().sign(payload, '1h');
}
