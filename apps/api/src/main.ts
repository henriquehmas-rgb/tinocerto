// startTracing() precisa rodar ANTES de qualquer módulo que a
// auto-instrumentação precisa interceptar (pg, http, express) ser
// `require`ido -- inclusive antes de 'reflect-metadata' e do próprio Nest.
// A instrumentação automática funciona via monkey-patch no `require` desses
// módulos: se algo já os tiver carregado (e portanto colocado no cache do
// Node) antes do SDK instalar o hook, o patch não se aplica a essa cópia
// cacheada e a instrumentação fica silenciosamente inativa.
import { startTracing } from './observability/tracing';
const sdk = startTracing();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Sem isso, spans ainda no buffer do BatchSpanProcessor (até
// scheduledDelayMillis, tipicamente uns segundos) são perdidos em todo
// restart/deploy -- justamente os spans do momento do shutdown. Não
// esperamos o shutdown terminar antes do processo encerrar de fato, só
// damos a chance do flush acontecer.
process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {});
});
process.on('SIGINT', () => {
  sdk.shutdown().catch(() => {});
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
