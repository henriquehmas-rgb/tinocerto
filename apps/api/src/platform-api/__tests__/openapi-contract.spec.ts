import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import * as YAML from 'yaml';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ApplicationController } from '../../hiring/application.controller';
import { RequisitionController } from '../../hiring/requisition.controller';
import { JobController } from '../../hiring/job.controller';
import { OfferController } from '../../hiring/offer.controller';
import { DecisionController } from '../../hiring/decision.controller';
import { PlatformApplicationController } from '../platform-application.controller';
import { DeveloperApiKeyController } from '../developer-api-key.controller';
import { PlatformPsychReportController } from '../platform-psych-report.controller';

const OPENAPI_ROOT = path.resolve(__dirname, '../../../openapi');

function listYamlFiles(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listYamlFiles(full, acc);
    else if (entrada.name.endsWith('.yaml')) acc.push(full);
  }
  return acc;
}

// Converte {id} (OpenAPI) -> :id (Express/Nest) e remove a barra inicial --
// as chaves de openapi.yaml.paths SEMPRE começam com '/' (exigência do
// próprio formato OpenAPI 3.1), então a comparação precisa normalizar os
// dois lados para a MESMA convenção (sem barra inicial).
function openApiPathToNest(p: string): string {
  return p.replace(/^\//, '').replace(/\{([^}]+)\}/g, ':$1');
}

// Desvio do plano: a versão original deste teste inicializava o AppModule
// INTEIRO (Test.createTestingModule({ imports: [AppModule] })) e
// introspeccionava o router Express (_router.stack) filtrando por PREFIXO
// de URL (startsWith('/v1/applications'), etc.). Dois defeitos genuínos
// nessa abordagem, achados ao rodar o teste pela primeira vez:
//
// 1. Toda chave de openapi.yaml.paths começa com '/' ("/v1/applications"),
//    mas o código comparava contra registeredPaths sem a barra (via
//    .slice(1)) e NUNCA normalizava documentedPaths correspondentemente --
//    100% das entradas divergiam só por causa da barra, mascarando
//    qualquer sinal real.
// 2. Filtrar por PREFIXO de URL ("começa com /v1/applications") varre
//    TAMBÉM controllers de OUTROS domínios que aninham rotas sob os mesmos
//    prefixos -- confirmado ao vivo: CandidateSummaryDraftController
//    (Copilot) registra v1/applications/:applicationId/candidate-summary-
//    drafts(...), JobDescriptionSuggestionController (Copilot) registra
//    v1/jobs/:jobId/description-suggestions(...), e mais rotas de
//    Matching (v1/applications/:id/adherence) e Insights
//    (v1/jobs/:id/adverse-impact). Nenhuma delas pertence ao domínio
//    Hiring que esta fatia documenta (design spec decisão 14) -- o filtro
//    por prefixo não tem como distingui-las de application/job de verdade.
//
// Correção: introspeccionar as PRÓPRIAS classes de controller do domínio
// Hiring (decorators @Controller/@Get/@Post via reflect-metadata), em vez
// do router Express da aplicação inteira. Continua provando contra a
// APLICAÇÃO REAL (as classes são as mesmas que o Nest usa para montar as
// rotas em produção -- não é uma lista mantida à mão que poderia divergir
// silenciosamente), só que precisamente escopado aos 6 controllers que
// pertencem a esta fatia, sem precisar inicializar o AppModule inteiro
// (módulo mais pesado do projeto -- Redis/Cerbos/MinIO/tracing) só para
// isso.
function routesOf(controller: new (...args: any[]) => unknown): Set<string> {
  const prefix: string = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
  const routes = new Set<string>();
  for (const propertyName of Object.getOwnPropertyNames(controller.prototype)) {
    if (propertyName === 'constructor') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (controller.prototype as any)[propertyName];
    if (typeof handler !== 'function') continue;
    const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (methodPath === undefined) continue; // não é uma rota (ex.: constructor, método privado sem decorator HTTP)
    const full = `${prefix}/${methodPath}`.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
    routes.add(full);
  }
  return routes;
}

describe('Documento OpenAPI -- nenhum contrato fictício', () => {
  it('todo arquivo .yaml sob openapi/ faz parse válido', () => {
    for (const file of listYamlFiles(OPENAPI_ROOT)) {
      expect(() => YAML.parse(readFileSync(file, 'utf-8'))).not.toThrow();
    }
  });

  it('todo path declarado em openapi.yaml corresponde a uma rota REAL registrada nos controllers do domínio Hiring (+ Plataforma API), e nenhuma rota real desses controllers ficou de fora', () => {
    const openapi = YAML.parse(readFileSync(path.join(OPENAPI_ROOT, 'openapi.yaml'), 'utf-8')) as {
      paths: Record<string, unknown>;
    };
    const documentedPaths = new Set(Object.keys(openapi.paths).map(openApiPathToNest));

    const registeredPaths = new Set<string>([
      ...routesOf(ApplicationController),
      ...routesOf(PlatformApplicationController),
      ...routesOf(RequisitionController),
      ...routesOf(JobController),
      ...routesOf(OfferController),
      ...routesOf(DecisionController),
      // Fase 4d: as duas peças novas da Plataforma API (emissão
      // self-service de chave + psych-report gated por CRP) também
      // documentadas em openapi.yaml -- mesma lógica de escopo do
      // comentário acima ("+ Plataforma API"), agora completada com os
      // controllers que esta fatia introduziu.
      ...routesOf(DeveloperApiKeyController),
      ...routesOf(PlatformPsychReportController),
    ]);

    for (const documented of documentedPaths) {
      expect(registeredPaths.has(documented)).toBe(true);
    }
    for (const real of registeredPaths) {
      expect(documentedPaths.has(real)).toBe(true);
    }
  });
});
