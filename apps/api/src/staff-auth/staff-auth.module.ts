import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffAccountService } from './staff-account.service';
import { StaffTokenService } from './staff-token.service';
import { StaffJwtService } from './staff-jwt.service';
import { PasswordService } from './password.service';
import { MfaService } from './mfa.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { TenantContext } from '../database/tenant-context';

@Module({
  imports: [DatabaseModule],
  controllers: [StaffAuthController],
  providers: [
    StaffOnboardingService,
    StaffAccountService,
    StaffTokenService,
    StaffJwtService,
    PasswordService,
    MfaService,
    EnvelopeEncryptionService,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
    // `StaffOnboardingService` injeta `TenantContext` diretamente (abre sua
    // própria transação para o INSERT de `tenant`, ver Task 4) -- só
    // `StaffAuthController` tem acesso a `DatabaseService` para construir o
    // seu próprio `TenantContext` manualmente (mesmo padrão de
    // `CandidateAuthController`), então o service precisa deste provider.
    { provide: TenantContext, useFactory: (db: DatabaseService) => new TenantContext(db.pool), inject: [DatabaseService] },
  ],
  exports: [StaffJwtService],
})
export class StaffAuthModule {}
