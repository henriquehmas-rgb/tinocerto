import { CerbosService } from '../cerbos.service';

describe('CerbosService — policy do laudo psicológico', () => {
  const cerbos = new CerbosService(process.env.CERBOS_HTTP_URL!);

  it('nega leitura para admin_tenant sem CRP ativo — mesmo sendo admin', async () => {
    const result = await cerbos.check(
      { id: 'user-1', roles: ['admin_tenant'], attr: { crp_ativo: false } },
      { kind: 'laudo_psicologico', id: 'laudo-1', attr: { psicologo_responsavel_id: 'outro-user' } },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  it('permite leitura para o psicólogo autor do laudo', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '123456', crp_uf: 'SP' },
      },
      { kind: 'laudo_psicologico', id: 'laudo-1', attr: { psicologo_responsavel_id: 'psi-1' } },
      ['read'],
    );
    expect(result.read).toBe(true);
  });

  it('nega leitura para psicólogo de UF diferente que não é o autor', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-2',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '654321', crp_uf: 'RJ' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });
});
