import { InstrumentVersionController } from '../instrument-version.controller';

describe('InstrumentVersionController', () => {
  it('lista as versões de instrumento ativas', async () => {
    const tenantContextRun = jest.fn((_tenantId: string, fn: (client: unknown) => unknown) => fn({}));
    const pool = { query: jest.fn() };
    const controller = new InstrumentVersionController(pool as never);
    (controller as unknown as { tenantContext: { run: typeof tenantContextRun } }).tenantContext = {
      run: tenantContextRun,
    };
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'iv-1', nome: 'Perfil Comportamental Tinocerto', versao: 1 }],
    });

    const req = { tenantId: 't1', userId: 'u1', userRoles: ['admin_tenant'] } as never;
    const result = await controller.listar(req);

    expect(result).toEqual([{ id: 'iv-1', nome: 'Perfil Comportamental Tinocerto', versao: 1 }]);
  });
});
