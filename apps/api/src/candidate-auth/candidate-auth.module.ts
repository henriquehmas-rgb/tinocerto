import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { CandidateAuthController } from './candidate-auth.controller';
import { CandidateApplicationController } from './candidate-application.controller';
import { CandidateAccountService } from './candidate-account.service';
import { CandidateTokenService } from './candidate-token.service';
import { CandidateJwtService } from './candidate-jwt.service';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { EmailService } from './email.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { IpRateLimitService } from '../security/ip-rate-limit.service';
import { IpRateLimitGuard } from '../security/ip-rate-limit.guard';
import { PersonService } from '../talent/person.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [CandidateAuthController, CandidateApplicationController],
  providers: [
    CandidateAccountService,
    CandidateTokenService,
    CandidateJwtService,
    CandidateAuthGuard,
    EmailService,
    PasswordResetService,
    PasswordService,
    IpRateLimitService,
    IpRateLimitGuard,
    PersonService,
    EnvelopeEncryptionService,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
  ],
  exports: [CandidateAuthGuard, CandidateJwtService],
})
export class CandidateAuthModule {}
