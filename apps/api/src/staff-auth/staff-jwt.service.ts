import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export interface StaffJwtPayload {
  userId: string;
  tenantId: string;
  roles: string[];
}

// Discriminador explícito do access token real -- mesma técnica de
// `StaffMfaChallengePayload.tipo` abaixo, na direção oposta: sem isso,
// `verify()` aceitava QUALQUER token assinado com o mesmo segredo,
// inclusive um `mfa_challenge` de curta duração emitido por
// `signMfaChallenge()` (confusão de tokens -- CRÍTICO, Task 8 review).
// `sign()` estampa `tipo: 'access'` sozinho (nenhum call site precisa
// passar isso) e `verify()` exige exatamente esse valor.
interface StaffAccessTokenPayload extends StaffJwtPayload {
  tipo: 'access';
}

// Payload do token de desafio de MFA (Task 7) -- assinado/verificado pelo
// MESMO StaffJwtService (mesmo segredo) que o access token, mas NUNCA deve
// ser aceito como access token. `tipo: 'mfa_challenge'` é o discriminador
// explícito: `verifyMfaChallenge` rejeita qualquer token sem esse campo
// (inclusive um access token real, que nunca carrega `tipo: 'mfa_challenge'`),
// e `verify` (abaixo) rejeita qualquer token sem `tipo: 'access'` -- fechando
// a confusão de tokens nos dois sentidos (um access token de vida longa
// sendo reapresentado a `login/mfa` como se fosse o desafio de curta
// duração, OU um desafio de MFA sendo reapresentado a qualquer rota
// autenticada normal como se fosse um access token completo).
export interface StaffMfaChallengePayload {
  tipo: 'mfa_challenge';
  userId: string;
  tenantId: string;
}

@Injectable()
export class StaffJwtService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.STAFF_JWT_SECRET;
    if (!secret) {
      throw new Error('STAFF_JWT_SECRET ausente — StaffJwtService nunca deve assinar/verificar sem segredo configurado');
    }
    this.secret = secret;
  }

  sign(payload: StaffJwtPayload, expiresIn: jwt.SignOptions['expiresIn'] = '15m'): string {
    const accessPayload: StaffAccessTokenPayload = { ...payload, tipo: 'access' };
    return jwt.sign(accessPayload, this.secret, { expiresIn });
  }

  // Rejeita (lança, no mesmo estilo de uma falha nativa de `jwt.verify` --
  // assinatura inválida/expirada) qualquer token que não seja um access
  // token genuíno: falta de `tipo: 'access'` (ex. um `mfa_challenge`
  // reapresentado aqui) ou `roles` que não seja de fato um array (nunca
  // repassa `undefined` silenciosamente para `StaffJwtPayload.roles`, que é
  // consumido rio abaixo como `string[]` por `CerbosGuard`/etc). O
  // try/catch de `TenantResolutionMiddleware` já converte qualquer exceção
  // daqui em 401 -- nenhum tratamento novo necessário no middleware.
  verify(token: string): StaffJwtPayload {
    const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
    if (decoded.tipo !== 'access') {
      throw new Error('Token não é um access token válido');
    }
    if (!Array.isArray(decoded.roles)) {
      throw new Error('Token de access sem roles válidas (esperado array)');
    }
    return { userId: decoded.userId, tenantId: decoded.tenantId, roles: decoded.roles };
  }

  // Vida curta (5min) por padrão -- só precisa sobreviver ao tempo entre
  // `POST /login` (mfa_habilitado=true) e `POST /login/mfa` na mesma sessão
  // de login, nunca reaproveitado depois disso.
  signMfaChallenge(payload: { userId: string; tenantId: string }, expiresIn: jwt.SignOptions['expiresIn'] = '5m'): string {
    const challengePayload: StaffMfaChallengePayload = {
      tipo: 'mfa_challenge',
      userId: payload.userId,
      tenantId: payload.tenantId,
    };
    return jwt.sign(challengePayload, this.secret, { expiresIn });
  }

  // Rejeita explicitamente qualquer token sem `tipo: 'mfa_challenge'` --
  // ver nota em `StaffMfaChallengePayload` acima. Lança (em vez de devolver
  // um booleano) para que o caller nunca esqueça de tratar o caso inválido;
  // `StaffAuthController.loginMfa` converte para 401.
  verifyMfaChallenge(token: string): { userId: string; tenantId: string } {
    const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
    if (decoded.tipo !== 'mfa_challenge') {
      throw new Error('Token não é um mfa_challenge válido');
    }
    return { userId: decoded.userId, tenantId: decoded.tenantId };
  }
}
