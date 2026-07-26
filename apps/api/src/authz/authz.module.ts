import { Global, Module } from '@nestjs/common';
import { CerbosService } from './cerbos.service';
import { CerbosGuard } from './cerbos.guard';

@Global()
@Module({
  providers: [
    {
      provide: CerbosService,
      useFactory: () => new CerbosService(process.env.CERBOS_HTTP_URL!),
    },
    CerbosGuard,
  ],
  exports: [CerbosService, CerbosGuard],
})
export class AuthzModule {}
