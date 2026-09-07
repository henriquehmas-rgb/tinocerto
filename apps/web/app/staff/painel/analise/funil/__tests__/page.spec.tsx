import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FunilAgregadoPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/staff/painel/analise/funil',
}));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterFunilConsolidado: vi.fn(), obterPerfil: vi.fn() },
}));

describe('FunilAgregadoPage', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockarPerfil() {
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });
  }

  it('busca o funil com janela=30d por padrão e mostra as etapas', async () => {
    mockarPerfil();
    vi.mocked(staffPanelClient.obterFunilConsolidado).mockResolvedValue([
      { etapa: 'triagem', total: 10, conversao: null },
      { etapa: 'entrevista', total: 4, conversao: 40 },
    ]);

    render(<FunilAgregadoPage />);

    expect(await screen.findByText('Triagem')).toBeInTheDocument();
    expect(staffPanelClient.obterFunilConsolidado).toHaveBeenCalledWith('30d');
    expect(screen.getByText('4 · 40%')).toBeInTheDocument();
  });

  it('troca a janela ao clicar nos botões de período', async () => {
    mockarPerfil();
    vi.mocked(staffPanelClient.obterFunilConsolidado).mockResolvedValue([
      { etapa: 'triagem', total: 10, conversao: null },
      { etapa: 'entrevista', total: 4, conversao: 40 },
    ]);

    render(<FunilAgregadoPage />);
    await screen.findByText('Triagem');

    screen.getByRole('button', { name: '90 dias' }).click();

    await waitFor(() => expect(staffPanelClient.obterFunilConsolidado).toHaveBeenCalledWith('90d'));

    screen.getByRole('button', { name: 'Tudo' }).click();

    await waitFor(() => expect(staffPanelClient.obterFunilConsolidado).toHaveBeenCalledWith('tudo'));
  });

  it('mostra estado vazio quando não há candidaturas no período', async () => {
    mockarPerfil();
    vi.mocked(staffPanelClient.obterFunilConsolidado).mockResolvedValue([
      { etapa: 'triagem', total: 0, conversao: null },
      { etapa: 'entrevista', total: 0, conversao: null },
    ]);

    render(<FunilAgregadoPage />);

    expect(await screen.findByText('Nenhuma candidatura no período selecionado')).toBeInTheDocument();
  });

  it('redireciona para /staff/entrar em erro de autenticação', async () => {
    mockarPerfil();
    vi.mocked(staffPanelClient.obterFunilConsolidado).mockRejectedValue(
      new Error('Sessão expirada, faça login novamente'),
    );

    render(<FunilAgregadoPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
