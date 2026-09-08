import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffPanelClient } from '../staff-panel-client';

describe('staffPanelClient.obterResumoCandidatoAtual', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.setItem('tinocerto_staff_access_token', 'token-de-teste');
    localStorage.setItem('tinocerto_staff_refresh_token', 'refresh-de-teste');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('retorna null quando o backend responde 200 com corpo vazio (nenhum rascunho aplicado ainda)', async () => {
    // Reproduz o comportamento real do NestJS/Express: quando o handler
    // retorna `null`, o ExpressAdapter chama `response.send()` sem corpo
    // nenhum (nem os 4 bytes de null) -- por isso o teste usa uma
    // `Response` real com corpo vazio, e não um mock que devolveria um
    // objeto JS já parseado (o que nunca exercitaria o bug de
    // `SyntaxError: Unexpected end of JSON input` do `response.json()`).
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));

    const resultado = await staffPanelClient.obterResumoCandidatoAtual('app-1');

    expect(resultado).toBeNull();
  });

  it('retorna o rascunho quando o backend responde 200 com JSON', async () => {
    const draft = { id: 'draft-1', texto: 'resumo gerado' };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(draft), { status: 200 }));

    const resultado = await staffPanelClient.obterResumoCandidatoAtual('app-1');

    expect(resultado).toEqual(draft);
  });
});

describe('staffPanelClient.obterTendenciaCandidaturas', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.setItem('tinocerto_staff_access_token', 'token-de-teste');
    localStorage.setItem('tinocerto_staff_refresh_token', 'refresh-de-teste');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('busca /v1/jobs/dashboard-tendencia com dias=30 por padrão', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ data: '2026-08-01', total: 2 }])));

    const tendencia = await staffPanelClient.obterTendenciaCandidaturas();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/jobs/dashboard-tendencia?dias=30'),
      expect.anything(),
    );
    expect(tendencia).toEqual([{ data: '2026-08-01', total: 2 }]);
  });

  it('aceita um número de dias explícito', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));

    await staffPanelClient.obterTendenciaCandidaturas(7);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/jobs/dashboard-tendencia?dias=7'),
      expect.anything(),
    );
  });
});

describe('staffPanelClient.obterFunilConsolidado', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.setItem('tinocerto_staff_access_token', 'token-de-teste');
    localStorage.setItem('tinocerto_staff_refresh_token', 'refresh-de-teste');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('busca /v1/jobs/funil-agregado com janela=30d por padrão', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ etapa: 'triagem', total: 5, conversao: null }])));

    const funil = await staffPanelClient.obterFunilConsolidado();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/jobs/funil-agregado?janela=30d'),
      expect.anything(),
    );
    expect(funil).toEqual([{ etapa: 'triagem', total: 5, conversao: null }]);
  });

  it('aceita uma janela explícita', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));

    await staffPanelClient.obterFunilConsolidado('tudo');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/jobs/funil-agregado?janela=tudo'),
      expect.anything(),
    );
  });
});

describe('staffPanelClient.listarRequisicoes', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.setItem('tinocerto_staff_access_token', 'token-de-teste');
    localStorage.setItem('tinocerto_staff_refresh_token', 'refresh-de-teste');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('busca /v1/requisitions', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ id: 'req-1', titulo: 'Inicial', status: 'aprovada' }])));

    const requisicoes = await staffPanelClient.listarRequisicoes();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/requisitions$/), expect.anything());
    expect(requisicoes).toEqual([{ id: 'req-1', titulo: 'Inicial', status: 'aprovada' }]);
  });
});

describe('staffPanelClient.listarEquipe', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.setItem('tinocerto_staff_access_token', 'token-de-teste');
    localStorage.setItem('tinocerto_staff_refresh_token', 'refresh-de-teste');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('busca /v1/staff', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ id: 'u1', email: 'ana@empresa.example', papeis: ['recrutador'] }])));

    const equipe = await staffPanelClient.listarEquipe();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/staff$/), expect.anything());
    expect(equipe).toEqual([{ id: 'u1', email: 'ana@empresa.example', papeis: ['recrutador'] }]);
  });
});
