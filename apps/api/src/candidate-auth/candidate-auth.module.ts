import { Module } from '@nestjs/common';
import { CandidateAuthController } from './candidate-auth.controller';
import { CandidateAccountService } from './candidate-account.service';
import { CandidateTokenService } from './candidate-token.service';
import { CandidateJwtService } from './candidate-jwt.service';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { PasswordService } from './password.service';
import { EmailService } from './email.service';
import { PasswordResetService } from './password-reset.service';
import { PersonService } from '../talent/person.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';

@Module({
  controllers: [CandidateAuthController],
  providers: [
    CandidateAccountService,
    CandidateTokenService,
    CandidateJwtService,
    CandidateAuthGuard,
    PasswordService,
    EmailService,
    PasswordResetService,
    PersonService,
    EnvelopeEncryptionService,
  ],
  exports: [CandidateAuthGuard, CandidateJwtService],
})
export class CandidateAuthModule {}
