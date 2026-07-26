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

  // Achado N3 (isolamento de tenant): mesmo sendo o autor de fato, com CRP
  // ativo e válido, um tenant_id de principal diferente do tenant_id do
  // resource deve negar o acesso.
  //
  // Atualizado na 3a rodada de fix: a checagem de tenant não vive mais
  // como condição duplicada dentro da regra "acesso-laudo-integra" — ela
  // foi centralizada na regra DENY universal "bloqueio-tenant-diferente"
  // (roles: ["*"]) em resource_laudo_psicologico.yaml, que cobre TODA
  // regra ALLOW do resource. Este teste prova que o comportamento
  // observável continua o mesmo (DENY cross-tenant) mesmo após essa
  // reestruturação.
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

  // Novo teste (3a rodada - achado do revisor sobre breakglass cross-tenant):
  // antes deste fix, a regra "breakglass-suporte" concedia ALLOW para role
  // suporte_nivel3 SEM nenhuma checagem de tenant — um suporte do tenant 1
  // com ticket de breakglass válido conseguia ler laudo do tenant 2. A
  // regra DENY universal "bloqueio-tenant-diferente" agora cobre esse role
  // também, sem precisar de lógica extra na regra breakglass-suporte.
  //
  // Limitação deste teste: CerbosService.check() (importado acima) não
  // expõe aux_data, e nenhum teste deste arquivo simula aux_data — então
  // não dá pra disparar de fato a condição
  // "request.aux_data.jwt.breakglass_ticket_id != vazio" da regra
  // breakglass-suporte por aqui (infra/cerbos.yaml também não tem
  // auxData.jwt configurado no servidor real). Por isso simulamos a
  // "credencial de breakglass" via attr solto (breakglass_ticket_id), não
  // via aux_data.jwt de verdade. O objetivo deste teste é mais restrito:
  // provar que o role suporte_nivel3, mesmo com CRP válido, é barrado pela
  // regra DENY universal de tenant quando o tenant do principal diverge do
  // tenant do resource — independente de qual regra ALLOW exista para esse
  // role. A prova de que a regra DENY também vence quando
  // breakglass-suporte de fato dispara (via aux_data.jwt real, contra o
  // servidor Cerbos rodando, com uma policy de verificação descartável)
  // foi feita manualmente — ver task-10-fix3-report.md.
  it('nega leitura para suporte_nivel3 (cenário breakglass) com tenant do principal diferente do tenant do resource', async () => {
    const result = await cerbos.check(
      {
        id: 'suporte-1',
        roles: ['suporte_nivel3'],
        attr: {
          crp_ativo: true,
          crp_numero: '000000',
          crp_uf: 'SP',
          tenant_id: 'tenant-1',
          breakglass_ticket_id: 'TICKET-SIMULADO-123',
        },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'outro-user', tenant_id: 'tenant-2' },
      },
      ['read'],
    );
    expect(result.read).toBe(false);
  });

  // Novo teste (3a rodada - mitigação do achado sobre valor degenerado):
  // tenant_id presente nos dois lados, mas como string vazia. O guard
  // has() sozinho não pega esse caso (a chave existe), então a regra DENY
  // universal também precisa checar size(...) > 0 nos dois lados. Prova
  // que string vazia não é tratada como "igual" por acidente — mesmo
  // sendo o autor de fato, com CRP válido.
  it('nega leitura quando tenant_id é string vazia dos dois lados, mesmo sendo o autor de fato', async () => {
    const result = await cerbos.check(
      {
        id: 'psi-1',
        roles: ['psicologo_responsavel'],
        attr: { crp_ativo: true, crp_numero: '123456', crp_uf: 'SP', tenant_id: '' },
      },
      {
        kind: 'laudo_psicologico',
        id: 'laudo-1',
        attr: { psicologo_responsavel_id: 'psi-1', tenant_id: '' },
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
