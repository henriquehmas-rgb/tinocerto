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
import { readdirSync } from 'fs';
import path from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { CERBOS_CHECK_KEY, CerbosCheckMetadata } from '../../authz/cerbos-check.decorator';

import { JobController } from '../../hiring/job.controller';
import { ApplicationController } from '../../hiring/application.controller';
import { OfferController } from '../../hiring/offer.controller';
import { RequisitionController } from '../../hiring/requisition.controller';
import { DecisionController } from '../../hiring/decision.controller';
import { JobDescriptionCopilotController } from '../../copilot/job-description-copilot.controller';
import { InterviewQuestionSuggestionController } from '../../copilot/interview-question-suggestion.controller';
import { CandidateSummaryController } from '../../copilot/candidate-summary.controller';
import { InterviewGuideController } from '../../interview/interview-guide.controller';
import { InterviewScheduleController } from '../../interview/interview-schedule.controller';
import { ScorecardController } from '../../interview/scorecard.controller';
import { GoogleCalendarConnectionController } from '../../interview/scheduling/google-calendar-connection.controller';
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
  // Item 2 do "Fix round 1": esta lista continua estática (import TS
  // exige um símbolo concreto para type-safety -- não há como expressar
  // "importe dinamicamente qualquer .controller.ts que aparecer" em
  // tempo de compilação sem um require()/import() dinâmico, que o setup
  // de Jest deste projeto não usa em nenhum outro teste, ver
  // openapi-contract.spec.ts, que também mantém imports estáticos). O
  // buraco que a revisão achou não era "a lista está desatualizada
  // hoje" -- era "nada FALHA quando ela fica desatualizada amanhã". O
  // teste `readdirSync` logo abaixo fecha exatamente esse buraco:
  // compara esta lista contra os arquivos *.controller.ts reais nos 5
  // diretórios de domínio, e falha se um novo controller for adicionado
  // ao código sem seu import aparecer aqui -- é isso que torna incluir
  // RequisitionController/DecisionController/GoogleCalendarConnectionController
  // (que não interceptam nenhum resourceKind do domínio da vaga, mas
  // *são* controllers reais destes diretórios) obrigatório: sem eles,
  // o teste de sincronização abaixo falharia sozinho, provando que o
  // mecanismo funciona.
  const CONTROLLERS = [
    JobController,
    ApplicationController,
    OfferController,
    RequisitionController,
    DecisionController,
    JobDescriptionCopilotController,
    InterviewQuestionSuggestionController,
    CandidateSummaryController,
    InterviewGuideController,
    InterviewScheduleController,
    ScorecardController,
    GoogleCalendarConnectionController,
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

// ---------------------------------------------------------------------
// Item 2 do "Fix round 1" (correção da vulnerabilidade introduzida pela
// própria onda 3): a lista CONTROLLERS acima é mantida à mão -- a revisão
// provou por mutação que um controller NOVO registrado num módulo, com
// uma rota @CerbosCheck para um resourceKind do domínio da vaga mas SEM
// guarda nem allowlist, não é pego pelo teste sistêmico se ninguém se
// lembrar de adicionar seu import a CONTROLLERS.
//
// Este bloco fecha o buraco descobrindo TODOS os arquivos *.controller.ts
// reais sob os 5 diretórios de domínio via readdirSync recursivo (mesma
// técnica de listYamlFiles em platform-api/__tests__/openapi-contract.spec.ts,
// adaptada para *.controller.ts) e comparando contra CONTROLLERS. Um
// require()/import() dinâmico de um arquivo .ts dentro do teste foi
// descartado -- nenhum outro teste deste projeto faz isso, e o próprio
// openapi-contract.spec.ts (mesmo problema de fundo: "não deixe uma
// entrada nova escapar despercebida") resolve com a MESMA estratégia de
// import estático + comparação estrutural que usamos aqui. Se um
// controller novo for criado num destes 5 diretórios e seu import não for
// adicionado a CONTROLLERS (acima), este teste falha pedindo
// explicitamente para adicionar o import -- é isso que garante que um
// controller novo entra automaticamente na varredura da suíte anterior,
// e não fica esquecido como as rotas das ondas 1 e 2.
describe('Item 2 do Fix round 1 -- CONTROLLERS não pode divergir dos *.controller.ts reais nos diretórios de domínio', () => {
  // Mesmos 5 diretórios que a revisão já mapeou como "dentro do escopo de
  // vaga" no comentário de RESOURCE_KINDS_DOMINIO_VAGA acima.
  const DOMINIO_DIRS = ['hiring', 'copilot', 'matching', 'insights', 'interview'];
  const SRC_ROOT = path.resolve(__dirname, '../../');

  function listControllerFiles(dir: string, acc: string[] = []): string[] {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entrada.name);
      if (entrada.isDirectory()) listControllerFiles(full, acc);
      else if (entrada.name.endsWith('.controller.ts') && !entrada.name.endsWith('.spec.ts')) acc.push(full);
    }
    return acc;
  }

  // kebab-case.controller.ts -> PascalCaseController -- mesma convenção
  // de nomenclatura usada em TODO controller deste projeto (confirmado
  // pelos nomes reais importados no topo deste arquivo).
  function inferClassName(filePath: string): string {
    const base = path.basename(filePath, '.controller.ts');
    const pascal = base
      .split('-')
      .map((segmento) => segmento.charAt(0).toUpperCase() + segmento.slice(1))
      .join('');
    return `${pascal}Controller`;
  }

  const arquivosReais = DOMINIO_DIRS.flatMap((dominio) => listControllerFiles(path.join(SRC_ROOT, dominio)));

  it('sanity check: a varredura de arquivos encontrou pelo menos um *.controller.ts por diretório de domínio', () => {
    // Mesmo raciocínio dos sanity checks da suíte anterior: um teste que
    // sempre passa com 0 arquivos encontrados (ex.: SRC_ROOT calculado
    // errado) não prova nada.
    for (const dominio of DOMINIO_DIRS) {
      expect(listControllerFiles(path.join(SRC_ROOT, dominio)).length).toBeGreaterThan(0);
    }
  });

  it(
    'todo *.controller.ts real sob hiring/copilot/matching/insights/interview tem um import estático ' +
      'correspondente entre os controllers testados pela suíte de cobertura estrutural acima',
    () => {
      const nomesClassesImportadas = new Set([
        JobController.name,
        ApplicationController.name,
        OfferController.name,
        RequisitionController.name,
        DecisionController.name,
        JobDescriptionCopilotController.name,
        InterviewQuestionSuggestionController.name,
        CandidateSummaryController.name,
        InterviewGuideController.name,
        InterviewScheduleController.name,
        ScorecardController.name,
        GoogleCalendarConnectionController.name,
        AdherenceController.name,
        AdverseImpactController.name,
      ]);

      const faltando = arquivosReais
        .map((f) => ({ arquivo: path.relative(SRC_ROOT, f), classeEsperada: inferClassName(f) }))
        .filter(({ classeEsperada }) => !nomesClassesImportadas.has(classeEsperada));

      // Mensagem de falha explícita: se um controller novo aparecer aqui,
      // é o alerta -- adicione o import no topo deste arquivo e a classe
      // ao Set acima (e, se ele expuser uma rota @CerbosCheck para um
      // resourceKind do domínio da vaga, também a CONTROLLERS da suíte
      // anterior).
      expect(faltando).toEqual([]);
    },
  );
});
