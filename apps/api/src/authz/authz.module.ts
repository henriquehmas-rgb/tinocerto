import { Global, Module } from '@nestjs/common';
import { CerbosService } from './cerbos.service';

@Global()
@Module({
  providers: [
    {
      provide: CerbosService,
      useFactory: () => new CerbosService(process.env.CERBOS_HTTP_URL!),
    },
  ],
  exports: [CerbosService],
})
export class AuthzModule {}
