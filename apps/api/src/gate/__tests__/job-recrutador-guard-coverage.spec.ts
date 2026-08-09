// apps/api/src/gate/__tests__/job-recrutador-guard-coverage.spec.ts
//
// Item 4 da onda 3 de correção pós-revisão do Painel do Recrutador (Fase
// 5a): as ondas 1 e 2 fecharam rota por rota, cada vez que uma revisão
// achava mais buracos da MESMA classe de vulnerabilidade (recrutador sem
// atribuição em job_recrutador acessando recurso de OUTRO recrutador via
// chamada direta à API, contornando o painel). O padrão se repetiu duas
// vezes: corrigir só as rotas nomeadas deixa rotas irmãs esquecidas.
//
// Este teste prova uma invariante ESTRUTURAL, não um comportamento
// pontual: para TODO método de controller decorado com @CerbosCheck cujo
// resourceKind é um dos recursos "dentro do domínio de uma vaga" (job,
// application, offer, interview_guide, interview_schedule -- os
// resourceKind cujas policies em cerbos/policies/*.yaml liberam o papel
// "recrutador"), o handler correspondente precisa estar classificado EM UM
// DOS DOIS lugares abaixo:
//
//   1. ROTAS_COM_GUARDA -- handlers confirmados (por leitura manual do
//      código, na hora em que cada onda de correção foi aplicada) a
//      chamar JobRecrutadorService.exigirAcesso em algum ponto do corpo.
//      Não há como introspeccionar "o corpo do método chama X" via
//      reflect-metadata (isso exigiria parsing de AST) -- esta lista é
//      mantida À MÃO, e é precisamente o mecanismo que este teste usa
//      para nunca mais deixar uma rota se perder: se uma rota nova for
//      decorada com @CerbosCheck para um destes resourceKind e NINGUÉM
//      adicionar sua entrada aqui nem na allowlist abaixo, o teste falha.
//
//   2. ALLOWLIST -- rotas que deliberadamente NÃO precisam da guarda,
//      cada uma com um comentário justificando por quê (ex.: rotas de
//      criação sem recurso preexistente, rotas que operam sobre
//      requisition/service_account em vez de job_recrutador).
//
// A lista de rotas REAIS (primeira metade da comparação) vem de
// introspecção via reflect-metadata sobre os PRÓPRIOS controllers -- mesma
// técnica de `routesOf` já usada em
// platform-api/__tests__/openapi-contract.spec.ts (prova contra a
// aplicação real, não uma lista mantida à mão que poderia divergir
// silenciosamente).
import { PATH_METADATA } from '@nestjs/common/constants';
import { CERBOS_CHECK_KEY, CerbosCheckMetadata } from '../../authz/cerbos-check.decorator';

import { JobController } from '../../hiring/job.controller';
import { ApplicationController } from '../../hiring/application.controller';
import { OfferController } from '../../hiring/offer.controller';
import { JobDescriptionCopilotController } from '../../copilot/job-description-copilot.controller';
import { InterviewQuestionSuggestionController } from '../../copilot/interview-question-suggestion.controller';
import { CandidateSummaryController } from '../../copilot/candidate-summary.controller';
import { InterviewGuideController } from '../../interview/interview-guide.controller';
import { InterviewScheduleController } from '../../interview/interview-schedule.controller';
import { ScorecardController } from '../../interview/scorecard.controller';
import { PlatformApplicationController } from '../../platform-api/platform-application.controller';
import { AdherenceController } from '../../matching/adherence.controller';
import { AdverseImpactController } from '../../insights/adverse-impact.controller';

// Resource kinds "dentro do domínio de uma vaga" -- confirmado lendo
// cerbos/policies/resource_*.yaml: são os únicos 5 arquivos cuja lista de
// `roles` do ALLOW inclui "recrutador" (resource_job.yaml,
// resource_application.yaml, resource_offer.yaml,
// resource_interview_guide.yaml, resource_interview_schedule.yaml).
// resource_scorecard.yaml também tem "recrutador", mas nenhuma rota real
// usa @CerbosCheck('scorecard', ...) -- ScorecardController usa
// @CerbosCheck('interview_schedule', ...) como coarse gate (ver comentário
// no topo de scorecard.controller.ts) e checa 'scorecard' fino via
// CerbosService direto dentro do service, fora do alcance de @CerbosCheck.
// resource_api_key/requisition/webhook_endpoint/google_calendar_connection/
// assessment/decision/laudo_psicologico não liberam "recrutador".
const RESOURCE_KINDS_DOMINIO_VAGA = new Set(['job', 'application', 'offer', 'interview_guide', 'interview_schedule']);

interface RotaDecorada {
  controller: string;
  handler: string;
  resourceKind: string;
  action: string;
}

// Mesma técnica de `routesOf` de openapi-contract.spec.ts, adaptada para
// também capturar o metadata do @CerbosCheck (mesma chave
// CERBOS_CHECK_KEY que o decorator usa via SetMetadata -- ver
// cerbos-check.decorator.ts) em vez de só o path.
function cerbosCheckedRoutesOf(controller: new (...args: any[]) => unknown): RotaDecorada[] {
  const rotas: RotaDecorada[] = [];
  for (const propertyName of Object.getOwnPropertyNames(controller.prototype)) {
    if (propertyName === 'constructor') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (controller.prototype as any)[propertyName];
    if (typeof handler !== 'function') continue;
    const isRoute = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) !== undefined;
    if (!isRoute) continue; // não é uma rota (ex.: métodos privados auxiliares, como exigirPosseDa*)
    const meta = Reflect.getMetadata(CERBOS_CHECK_KEY, handler) as CerbosCheckMetadata | undefined;
    if (!meta) continue; // rota sem @CerbosCheck -- fora do escopo deste teste (não é o achado das revisões)
    rotas.push({ controller: controller.name, handler: propertyName, resourceKind: meta.resourceKind, action: meta.action });
  }
  return rotas;
}

function chave(rota: Pick<RotaDecorada, 'controller' | 'handler'>): string {
  return `${rota.controller}.${rota.handler}`;
}

// ---------------------------------------------------------------------
// ROTAS_COM_GUARDA -- confirmado por leitura manual do código-fonte de
// cada handler abaixo, na onda de correção indicada, chamando
// JobRecrutadorService.exigirAcesso (direto ou via um helper privado do
// próprio controller que o chama) em algum ponto do corpo antes de
// delegar ao service correspondente.
// ---------------------------------------------------------------------
const ROTAS_COM_GUARDA = new Set<string>([
  // JobController (onda 1 -- Fase 5a, Tasks 3/4, + fixes C2/C4 da revisão
  // de coerência)
  'JobController.findOne',
  'JobController.funil',
  'JobController.atribuirRecrutadores',
  'JobController.editar',
  'JobController.publish',
  'JobController.declararHabilidadesExigidas',

  // ApplicationController (onda 1 -- Fase 5a, Task 4)
  'ApplicationController.findOne',
  'ApplicationController.moveStage',
  'ApplicationController.assessmentReport',
  'ApplicationController.reject',
  'ApplicationController.extendOffer',
  'ApplicationController.listOffers',
  'ApplicationController.markStartedWork',

  // OfferController (onda 3, Item 1 -- offer.controller.ts nunca tinha
  // guarda; resolve offer.id -> application_id -> job_id via
  // OfferService.buscarJobId)
  'OfferController.accept',
  'OfferController.decline',

  // JobDescriptionCopilotController (onda 2 -- achado Critical)
  'JobDescriptionCopilotController.gerar',
  'JobDescriptionCopilotController.listar',
  'JobDescriptionCopilotController.aplicar',

  // InterviewQuestionSuggestionController (onda 3, Item 2 -- achado
  // Critical; resolve versionId -> interview_guide.job_id via join)
  'InterviewQuestionSuggestionController.gerar',
  'InterviewQuestionSuggestionController.listar',

  // CandidateSummaryController (onda 2 -- achado Critical)
  'CandidateSummaryController.gerar',
  'CandidateSummaryController.atual',
  'CandidateSummaryController.aplicar',

  // InterviewGuideController (onda 3, Item 3 -- módulo interview/ nunca
  // tinha guarda, é anterior ao conceito de job_recrutador)
  'InterviewGuideController.criar',
  'InterviewGuideController.editar',
  'InterviewGuideController.publicar',
  'InterviewGuideController.gerar',

  // InterviewScheduleController (onda 3, Item 3; guarda pulada quando o
  // principal tem o papel "entrevistador" -- ver comentário em
  // interview-schedule.controller.ts. A rota AINDA está "com guarda":
  // ela roda condicionalmente, não foi simplesmente omitida)
  'InterviewScheduleController.criar',

  // ScorecardController (onda 3, Item 3; mesma exceção documentada para
  // o papel "entrevistador")
  'ScorecardController.submeter',
  'ScorecardController.listar',

  // AdherenceController (onda 2 -- achado C3 da revisão de coerência)
  'AdherenceController.porCandidatura',

  // AdverseImpactController (onda 2 -- achado C3 da revisão de coerência)
  'AdverseImpactController.porVaga',
]);

// ---------------------------------------------------------------------
// ALLOWLIST -- rotas @CerbosCheck para um resourceKind do domínio da vaga
// que deliberadamente NÃO chamam JobRecrutadorService.exigirAcesso, com
// justificativa.
// ---------------------------------------------------------------------
const ALLOWLIST: Record<string, string> = {
  'JobController.list':
    'GET /v1/jobs não opera sobre um :id de vaga específica -- lista todas as vagas visíveis ao ' +
    'requisitante. JobService.listar já recebe userId/userRoles e filtra internamente (papéis sem acesso ' +
    'total só veem vagas onde estão em job_recrutador); não há um único jobId para checar posse contra.',
  'JobController.create':
    'POST /v1/jobs cria uma vaga NOVA -- não existe recurso preexistente para checar posse contra. O ' +
    'próprio handler garante que o criador (req.userId) é SEMPRE incluído em recrutadorIds (achado C1 da ' +
    'revisão de coerência, ver comentário em job.controller.ts), o que dá posse imediata sobre a vaga recém-criada.',
  'PlatformApplicationController.list':
    'GET /v1/applications (Plataforma API, prefixo v1/applications mas classe distinta de ' +
    'ApplicationController -- ver comentário em platform-application.controller.ts) é autenticada via ' +
    'ApiKeyGuard (chave de API de service_account), não StaffJwt de um staff humano. O modelo de acesso é ' +
    'por escopo da chave (applications:read), não por atribuição individual em job_recrutador -- não há um ' +
    'req.userId de staff para checar contra job_recrutador; um service_account nunca é um "recrutador" no ' +
    'sentido que job_recrutador modela.',
};

describe('Cobertura estrutural da guarda de posse por recrutador (onda 3, Item 4)', () => {
  const CONTROLLERS = [
    JobController,
    ApplicationController,
    OfferController,
    JobDescriptionCopilotController,
    InterviewQuestionSuggestionController,
    CandidateSummaryController,
    InterviewGuideController,
    InterviewScheduleController,
    ScorecardController,
    PlatformApplicationController,
    AdherenceController,
    AdverseImpactController,
  ];

  const todasAsRotasDecoradas = CONTROLLERS.flatMap((c) => cerbosCheckedRoutesOf(c));

  it('sanity check: a introspecção encontrou pelo menos uma rota por controller listado', () => {
    // Se isso falhar, o próprio mecanismo de introspecção quebrou (ex.:
    // reflect-metadata não carregado, ou um controller foi renomeado) --
    // um teste que sempre passa com 0 rotas encontradas não prova nada.
    for (const controller of CONTROLLERS) {
      const rotas = cerbosCheckedRoutesOf(controller);
      expect(rotas.length).toBeGreaterThan(0);
    }
  });

  it('sanity check: RESOURCE_KINDS_DOMINIO_VAGA aparece de fato nas rotas introspeccionadas', () => {
    const kindsEncontrados = new Set(todasAsRotasDecoradas.map((r) => r.resourceKind));
    for (const kind of RESOURCE_KINDS_DOMINIO_VAGA) {
      expect(kindsEncontrados.has(kind)).toBe(true);
    }
  });

  it(
    'toda rota real @CerbosCheck para um resourceKind do domínio da vaga (job/application/offer/' +
      'interview_guide/interview_schedule) está OU em ROTAS_COM_GUARDA OU na ALLOWLIST (nunca nas duas, ' +
      'nunca em nenhuma)',
    () => {
      const rotasDoDominio = todasAsRotasDecoradas.filter((r) => RESOURCE_KINDS_DOMINIO_VAGA.has(r.resourceKind));
      expect(rotasDoDominio.length).toBeGreaterThan(0);

      const naoClassificadas: string[] = [];
      const classificadasNosDois: string[] = [];

      for (const rota of rotasDoDominio) {
        const k = chave(rota);
        const temGuarda = ROTAS_COM_GUARDA.has(k);
        const temAllowlist = k in ALLOWLIST;
        if (temGuarda && temAllowlist) classificadasNosDois.push(k);
        if (!temGuarda && !temAllowlist) naoClassificadas.push(k);
      }

      // Mensagem de falha explícita: se uma rota nova aparecer aqui, é
      // exatamente o alerta que este teste existe para dar -- ela precisa
      // ser classificada (guarda real OU allowlist justificada) antes do
      // merge, não pode ficar esquecida como as rotas das ondas 1 e 2.
      expect({ naoClassificadas, classificadasNosDois }).toEqual({ naoClassificadas: [], classificadasNosDois: [] });
    },
  );

  it('ROTAS_COM_GUARDA e ALLOWLIST não têm entradas obsoletas (toda entrada corresponde a uma rota real)', () => {
    const chavesReais = new Set(todasAsRotasDecoradas.map((r) => chave(r)));
    const guardaObsoleta = [...ROTAS_COM_GUARDA].filter((k) => !chavesReais.has(k));
    const allowlistObsoleta = Object.keys(ALLOWLIST).filter((k) => !chavesReais.has(k));
    expect({ guardaObsoleta, allowlistObsoleta }).toEqual({ guardaObsoleta: [], allowlistObsoleta: [] });
  });
});
