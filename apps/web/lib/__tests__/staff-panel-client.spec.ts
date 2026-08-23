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
    // nenhum (nem os 4 bytes de "null") -- por isso o teste usa uma
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
