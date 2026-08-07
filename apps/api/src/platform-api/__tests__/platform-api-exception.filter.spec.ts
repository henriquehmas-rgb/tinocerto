import { ArgumentsHost, ForbiddenException } from '@nestjs/common';
import { PlatformApiExceptionFilter } from '../platform-api-exception.filter';
import { PlatformApiProblem } from '../platform-api-problem';

function fakeHost(url: string) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ originalUrl: url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('PlatformApiExceptionFilter', () => {
  const filter = new PlatformApiExceptionFilter();

  it('PlatformApiProblem vira JSON RFC 9457 com type/status/extensions corretos', () => {
    const { host, status, json } = fakeHost('/v1/applications');
    filter.catch(new PlatformApiProblem(422, 'cursor-invalido', 'Cursor inválido', 'detalhe do erro', { campo: 'cursor' }), host);

    expect(status).toHaveBeenCalledWith(422);
    const body = json.mock.calls[0][0];
    expect(body.type).toBe('https://developers.tinocerto.com.br/problems/cursor-invalido');
    expect(body.title).toBe('Cursor inválido');
    expect(body.status).toBe(422);
    expect(body.detail).toBe('detalhe do erro');
    expect(body.instance).toBe('/v1/applications');
    expect(body.campo).toBe('cursor');
    expect(typeof body.trace_id).toBe('string');
  });

  it('HttpException genérica (ex.: ForbiddenException do CerbosGuard) vira problems/erro-http', () => {
    const { host, status, json } = fakeHost('/v1/applications');
    filter.catch(new ForbiddenException('Ação "read" não permitida'), host);

    expect(status).toHaveBeenCalledWith(403);
    const body = json.mock.calls[0][0];
    expect(body.type).toBe('https://developers.tinocerto.com.br/problems/erro-http');
    expect(body.detail).toBe('Ação "read" não permitida');
  });

  it('erro não mapeado vira 500 erro-interno sem vazar a mensagem original', () => {
    const { host, status, json } = fakeHost('/v1/applications');
    filter.catch(new Error('stack trace sensível com caminho de arquivo interno'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.type).toBe('https://developers.tinocerto.com.br/problems/erro-interno');
    expect(body.detail).not.toContain('stack trace sensível');
  });

  it('cada resposta tem um trace_id diferente', () => {
    const { host: h1, json: j1 } = fakeHost('/v1/applications');
    const { host: h2, json: j2 } = fakeHost('/v1/applications');
    filter.catch(new Error('x'), h1);
    filter.catch(new Error('x'), h2);
    expect(j1.mock.calls[0][0].trace_id).not.toBe(j2.mock.calls[0][0].trace_id);
  });
});
