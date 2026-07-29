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
import { ValidationPipe } from '@nestjs/common';
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

  // CORS: apps/web (Next.js, Tasks 15-17) roda em origem diferente da API
  // em todo ambiente de desenvolvimento (portas distintas sempre = origens
  // distintas para o navegador) e, plausivelmente, em produção tambem
  // (subdominio proprio para o front). Ate a Task 16 nada precisava disso
  // -- as paginas de carreiras sao SSR (fetch roda no servidor Next.js,
  // nunca no navegador, ver nota da Task 16). A Task 17 introduz os
  // primeiros fetches client-side ('use client') do produto direto do
  // navegador para a API, e sem isso todo POST de candidate-auth-client.ts
  // falha com Failed to fetch (bloqueio de CORS do navegador, silencioso
  // no lado do cliente) -- confirmado ao vivo durante a verificacao manual
  // da Task 17. Nenhum cookie de sessao esta envolvido (token Bearer em
  // header, ver Task 17), entao nao ha exposicao de CSRF classica em abrir
  // a origem; mesmo assim, restringe a WEB_ORIGIN (configuravel via env,
  // default o dev port documentado da Task 16/17) em vez de aceitar
  // qualquer origem.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3001' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
