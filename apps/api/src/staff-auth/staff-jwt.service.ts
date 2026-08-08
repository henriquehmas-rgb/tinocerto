import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export interface StaffJwtPayload {
  userId: string;
  tenantId: string;
  roles: string[];
}

// Payload do token de desafio de MFA (Task 7) -- assinado/verificado pelo
// MESMO StaffJwtService (mesmo segredo) que o access token, mas NUNCA deve
// ser aceito como access token. `tipo: 'mfa_challenge'` é o discriminador
// explícito: `verifyMfaChallenge` rejeita qualquer token sem esse campo
// (inclusive um access token real, que nunca carrega `tipo`), fechando a
// confusão de tokens (um access token de vida longa sendo reapresentado a
// `login/mfa` como se fosse o desafio de curta duração, ou vice-versa).
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
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  verify(token: string): StaffJwtPayload {
    const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
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
