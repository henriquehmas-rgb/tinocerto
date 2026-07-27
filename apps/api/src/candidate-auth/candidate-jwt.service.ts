import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export interface CandidateJwtPayload {
  candidateAccountId: string;
  personId: string;
}

@Injectable()
export class CandidateJwtService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.CANDIDATE_JWT_SECRET;
    if (!secret) {
      throw new Error('CANDIDATE_JWT_SECRET ausente — CandidateJwtService nunca deve assinar/verificar sem segredo configurado');
    }
    this.secret = secret;
  }

  sign(payload: CandidateJwtPayload, expiresIn: jwt.SignOptions['expiresIn'] = '15m'): string {
    return jwt.sign(payload, this.secret, { expiresIn });
  }

  verify(token: string): CandidateJwtPayload {
    const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
    return { candidateAccountId: decoded.candidateAccountId, personId: decoded.personId };
  }
}
