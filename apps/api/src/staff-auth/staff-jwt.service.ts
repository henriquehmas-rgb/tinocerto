import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export interface StaffJwtPayload {
  userId: string;
  tenantId: string;
  roles: string[];
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
}
