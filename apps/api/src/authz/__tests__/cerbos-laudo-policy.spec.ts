import { CerbosService } from '../cerbos.service';

describe('CerbosService — policy do laudo psicológico', () => {
  const cerbos = new CerbosService(process.env.CERBOS_HTTP_URL!);

  it('nega leitura para admin_tenant sem CRP ativo — mesmo sendo admin', async () => {
    const result = await cerbos.check(
      { id: 'user-1', roles: ['admin_tenant'], attr: { crp_ativo: false, tenant_id: 'tenant-1' } },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'outro-user', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  it('permite leitura para o psicólogo autor do laudo (mesmo tenant)', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '123456', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(true);
  });

  it('nega leitura para o AUTOR do laudo se o CRP dele estiver inativo (DENY vence ALLOW)', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: false, crp_numero: '123456', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  it('nega leitura para o autor do laudo se crp_ativo estiver AUSENTE (não apenas false)', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_numero: '123456', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  // Reescrito (achado N4): antes desta rodada de fix, "supervisor" com a
  // mesma UF do laudo recebia ALLOW só por coincidência de UF, sem
  // qualquer relação de supervisão real verificada. O dono do produto
  // decidiu que isso não é seguro o suficiente para produção e que
  // modelar supervisão de verdade é trabalho futuro maior — então, por
  // ora, a regra ALLOW baseada em psicologo_supervisor_mesmo_crp foi
  // removida da policy (fail closed: só o autor tem acesso). Este teste
  // agora prova que o "supervisor" por UF é NEGADO.
  it('nega leitura para psicólogo "supervisor" da mesma UF — ALLOW por UF removido (N4)', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-supervisor',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '999999', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  it('nega leitura para psicólogo de UF diferente que não é o autor', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-2',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '654321', crp_uf: 'RJ', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  // Novo teste (achado N3 — isolamento de tenant): mesmo sendo o autor de
  // fato, com CRP ativo e válido, um tenant_id de principal diferente do
  // tenant_id do resource deve negar o acesso. Prova que a condição de
  // igualdade de tenant adicionada em resource_laudo_psicologico.yaml
  // efetivamente bloqueia leitura cross-tenant.
  it('nega leitura para o autor do laudo se o tenant_id do principal for diferente do tenant_id do resource', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '123456', crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: 'tenant-2' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  // Novo teste (achado N1 — confusão de tipo): crp_numero chega com tipo
  // errado (boolean) em vez de string, mas o resto dos atributos seria
  // válido. Antes do fix, `string(request.principal.attr.crp_numero)`
  // lançava erro de CEL de forma silenciosa e permitia ALLOW indevido.
  // Agora a checagem `type(...) == string` nunca lança erro — só avalia
  // para false — então a regra DENY dispara corretamente.
  it('nega leitura quando crp_numero vem com tipo errado (boolean em vez de string)', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: true, crp_uf: 'SP', tenant_id: 'tenant-1' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: 'tenant-1' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });
});
