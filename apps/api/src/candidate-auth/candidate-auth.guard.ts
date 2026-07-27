import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { CandidateJwtService } from './candidate-jwt.service';

interface RequestWithCandidate extends Request {
  candidateAccountId: string;
  personId: string;
}

@Injectable()
export class CandidateAuthGuard implements CanActivate {
  constructor(private readonly jwtService: CandidateJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithCandidate>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de candidato ausente');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify(token);
      req.candidateAccountId = payload.candidateAccountId;
      req.personId = payload.personId;
      return true;
    } catch {
      throw new UnauthorizedException('Token de candidato inválido ou expirado');
    }
  }
}
