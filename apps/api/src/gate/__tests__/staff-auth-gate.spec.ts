// apps/api/src/gate/__tests__/staff-auth-gate.spec.ts
import { Pool } from 'pg';
import { authenticator } from 'otplib';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { EnvelopeEncryptionService, EncryptedPayload } from '../../talent/envelope-encryption.service';
import { mintStaffJwt } from '../../staff-auth/__tests__/mint-staff-jwt';

describe('Gate consolidado — Autenticação de staff, onboarding e MFA (Tasks 1-9)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Mesma KEK de `.env` (ENVELOPE_ENCRYPTION_KEK) que `MfaService` usa em
  // produção -- o teste precisa decifrar o `mfa_secret_cifrado` gravado por
  // `POST mfa/setup` para conseguir gerar um código TOTP real via `otplib`,
  // sem duplicar/hardcodar nenhum segredo próprio.
  const envelopeEncryption = new EnvelopeEncryptionService();

  let app: INestApplication;
  let serverUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);
    serverUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await adminPool.end();
  }, 20000);

  it(
    'ponta a ponta: onboarding cria tenant+admin -> login sem MFA -> habilita MFA (setup+verify) -> logout -> ' +
      'login passa a exigir 2º fator -> login/mfa com TOTP real emite tokens -> tokens funcionam numa rota real de ' +
      'Fase 1-4 com isolamento de tenant -> tokens ausentes/malformados/adulterados/de desafio-MFA são rejeitados com 401',
    async () => {
      let tenantId: string | undefined;
      let outroTenantId: string | undefined;
      let userId: string | undefined;

      try {
        // --- 1. Onboarding self-service: cria tenant + admin_tenant ---
        const cnpj = '00000000000198';
        const emailAdmin = 'admin-gate-staff-auth@example.com';
        const senhaAdmin = 'SenhaForte123!';

        const respOnboarding = await fetch(`${serverUrl}/v1/staff/auth/onboarding`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nomeEmpresa: 'Gate Staff Auth Ltda', cnpj, emailAdmin, senhaAdmin }),
        });
        expect(respOnboarding.status).toBe(201);
        const corpoOnboarding = (await respOnboarding.json()) as { accessToken: string; refreshToken: string };
        expect(corpoOnboarding.accessToken).toEqual(expect.any(String));
        expect(corpoOnboarding.refreshToken).toEqual(expect.any(String));

        const tenantRow = await adminPool.query<{ id: string }>('SELECT id FROM tenant WHERE cnpj = $1', [cnpj]);
        tenantId = tenantRow.rows[0].id;
        const userRow = await adminPool.query<{ id: string }>(
          'SELECT id FROM user_account WHERE tenant_id = $1 AND email = $2',
          [tenantId, emailAdmin],
        );
        userId = userRow.rows[0].id;

        // --- 2. Login sem MFA habilitado funciona e devolve os tokens finais direto ---
        const respLoginSemMfa = await fetch(`${serverUrl}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: emailAdmin, senha: senhaAdmin }),
        });
        expect(respLoginSemMfa.status).toBe(201);
        const corpoLoginSemMfa = (await respLoginSemMfa.json()) as {
          accessToken?: string;
          refreshToken?: string;
          mfaChallengeToken?: string;
        };
        expect(corpoLoginSemMfa.accessToken).toEqual(expect.any(String));
        expect(corpoLoginSemMfa.refreshToken).toEqual(expect.any(String));
        expect(corpoLoginSemMfa.mfaChallengeToken).toBeUndefined();
        const accessTokenSemMfa = corpoLoginSemMfa.accessToken!;
        const refreshTokenSemMfa = corpoLoginSemMfa.refreshToken!;

        // --- 3. Habilita MFA: mfa/setup grava o secret pendente, mfa/verify confirma com TOTP real ---
        const respMfaSetup = await fetch(`${serverUrl}/v1/staff/auth/mfa/setup`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessTokenSemMfa}` },
        });
        expect(respMfaSetup.status).toBe(201);
        const corpoMfaSetup = (await respMfaSetup.json()) as { qrCodeDataUri: string };
        expect(corpoMfaSetup.qrCodeDataUri.startsWith('data:image/png;base64,')).toBe(true);

        // O secret em si nunca trafega em claro pela API (só embutido no QR
        // code, que é uma imagem) -- o teste decifra `mfa_secret_cifrado`
        // direto do banco, exatamente como `MfaService.verificarCodigo` faz
        // internamente, para poder gerar um código TOTP real via `otplib`.
        const secretRow = await adminPool.query<{ mfa_secret_cifrado: EncryptedPayload }>(
          'SELECT mfa_secret_cifrado FROM user_account WHERE id = $1',
          [userId],
        );
        const totpSecret = envelopeEncryption.decrypt(secretRow.rows[0].mfa_secret_cifrado);

        const respMfaVerify = await fetch(`${serverUrl}/v1/staff/auth/mfa/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${accessTokenSemMfa}` },
          body: JSON.stringify({ codigoTotp: authenticator.generate(totpSecret) }),
        });
        expect(respMfaVerify.status).toBe(201);
        const corpoMfaVerify = (await respMfaVerify.json()) as { backupCodes: string[] };
        expect(corpoMfaVerify.backupCodes).toHaveLength(10);

        // --- 4. Logout revoga os refresh tokens desta sessão ---
        const respLogout = await fetch(`${serverUrl}/v1/staff/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessTokenSemMfa}` },
        });
        expect(respLogout.status).toBe(201);
        expect(await respLogout.json()).toEqual({ ok: true });

        // --- 4b. Prova de que o logout REALMENTE revogou o refresh token (não só
        // devolveu `{ ok: true }`): reapresentar o mesmo refresh token de antes do
        // logout precisa cair no caminho de detecção de reuso de `StaffTokenService.rotate`
        // (token já revogado) e ser rejeitado com 401 -- um handler de `logout` que
        // devolvesse sucesso sem chamar `revokeAll` passaria pela asserção acima mas
        // falharia aqui.
        const respRefreshAposLogout = await fetch(`${serverUrl}/v1/staff/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${accessTokenSemMfa}` },
          body: JSON.stringify({ refreshToken: refreshTokenSemMfa }),
        });
        expect(respRefreshAposLogout.status).toBe(401);

        // --- 5. Login agora exige o 2º fator: devolve só o mfaChallengeToken ---
        const respLoginComMfa = await fetch(`${serverUrl}/v1/staff/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: emailAdmin, senha: senhaAdmin }),
        });
        expect(respLoginComMfa.status).toBe(201);
        const corpoLoginComMfa = (await respLoginComMfa.json()) as {
          mfaChallengeToken?: string;
          accessToken?: string;
          refreshToken?: string;
        };
        expect(corpoLoginComMfa.mfaChallengeToken).toEqual(expect.any(String));
        expect(corpoLoginComMfa.accessToken).toBeUndefined();
        expect(corpoLoginComMfa.refreshToken).toBeUndefined();
        const mfaChallengeToken = corpoLoginComMfa.mfaChallengeToken!;

        // --- 6. login/mfa com o código TOTP real completa o login e emite tokens de verdade ---
        const respLoginMfa = await fetch(`${serverUrl}/v1/staff/auth/login/mfa`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mfaChallengeToken, codigoTotp: authenticator.generate(totpSecret) }),
        });
        expect(respLoginMfa.status).toBe(201);
        const corpoLoginMfa = (await respLoginMfa.json()) as { accessToken: string; refreshToken: string };
        expect(corpoLoginMfa.accessToken).toEqual(expect.any(String));
        expect(corpoLoginMfa.refreshToken).toEqual(expect.any(String));
        const accessToken = corpoLoginMfa.accessToken;

        // --- 7. Fixture de uma rota real de Fase 1-4 (application) para provar que o access token funciona ---
        const orgUnit = await adminPool.query<{ id: string }>(
          `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
          [tenantId],
        );
        const requisition = await adminPool.query<{ id: string }>(
          `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate Staff Auth', 'aprovada', now()) RETURNING id`,
          [tenantId, orgUnit.rows[0].id],
        );
        const job = await adminPool.query<{ id: string }>(
          `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate Staff Auth', 'vaga-gate-staff-auth') RETURNING id`,
          [tenantId, requisition.rows[0].id],
        );
        const person = await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ('hash-gate-staff-auth', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Gate Staff Auth', 'gate-staff-auth@example.com') RETURNING id`,
        );
        const application = await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, job.rows[0].id, person.rows[0].id],
        );
        const applicationId = application.rows[0].id;

        // --- 8. O access token emitido por login/mfa é aceito por uma rota real e devolve o dado do tenant certo ---
        const respApplication = await fetch(`${serverUrl}/v1/applications/${applicationId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(respApplication.status).toBe(200);
        const corpoApplication = (await respApplication.json()) as { id: string; person: { nome: string } };
        expect(corpoApplication.id).toBe(applicationId);
        expect(corpoApplication.person.nome).toBe('Candidato Gate Staff Auth');

        // --- 9. Isolamento de tenant: um token de OUTRO tenant não vê a candidatura deste ---
        const outroTenant = await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate Staff Auth Outro Ltda','00000000000199','test-tenant-gate-staff-auth-outro') RETURNING id`,
        );
        outroTenantId = outroTenant.rows[0].id;
        const outroTokenAccess = mintStaffJwt({
          userId: '00000000-0000-0000-0000-000000000001',
          tenantId: outroTenantId,
          roles: ['admin_tenant'],
        });
        const respApplicationOutroTenant = await fetch(`${serverUrl}/v1/applications/${applicationId}`, {
          headers: { authorization: `Bearer ${outroTokenAccess}` },
        });
        expect(respApplicationOutroTenant.status).toBe(404);

        // --- 10. Sem Authorization -- 401, nunca 500 ---
        const respSemAuth = await fetch(`${serverUrl}/v1/applications/${applicationId}`);
        expect(respSemAuth.status).toBe(401);

        // --- 11. JWT com assinatura adulterada (um caractere do meio trocado) -- 401, nunca 500 ---
        const partes = accessToken.split('.');
        const meioAdulterado = partes[1].slice(0, Math.floor(partes[1].length / 2)) === 'a'
          ? 'b' + partes[1].slice(1)
          : 'a' + partes[1].slice(1);
        const tokenAdulterado = [partes[0], meioAdulterado, partes[2]].join('.');
        const respTokenAdulterado = await fetch(`${serverUrl}/v1/applications/${applicationId}`, {
          headers: { authorization: `Bearer ${tokenAdulterado}` },
        });
        expect(respTokenAdulterado.status).toBe(401);

        // --- 12. Regressão CRÍTICA (Task 8): o mfaChallengeToken emitido em `login` NUNCA pode
        // funcionar como access token contra uma rota autenticada real -- é exatamente o caminho
        // de ataque de confusão de tokens que `StaffJwtService.sign/verify` (discriminador
        // `tipo: 'access'`) fecha. Prova ponta a ponta via HTTP, não só no nível de unidade
        // (já coberto por `staff-jwt.service.spec.ts`).
        const respMfaChallengeComoAccessToken = await fetch(`${serverUrl}/v1/applications/${applicationId}`, {
          headers: { authorization: `Bearer ${mfaChallengeToken}` },
        });
        expect(respMfaChallengeComoAccessToken.status).toBe(401);
      } finally {
        if (tenantId) {
          await adminPool.query(
            `DELETE FROM application WHERE job_id IN (SELECT id FROM job WHERE tenant_id = $1)`,
            [tenantId],
          );
          await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-staff-auth'`);
          await adminPool.query(`DELETE FROM job WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM requisition WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM org_unit WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM staff_refresh_token WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM role_assignment WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM user_account WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
        }
        if (outroTenantId) {
          await adminPool.query(`DELETE FROM staff_refresh_token WHERE tenant_id = $1`, [outroTenantId]);
          await adminPool.query(`DELETE FROM role_assignment WHERE tenant_id = $1`, [outroTenantId]);
          await adminPool.query(`DELETE FROM user_account WHERE tenant_id = $1`, [outroTenantId]);
          await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [outroTenantId]);
        }
      }
    },
    60000,
  );
});
