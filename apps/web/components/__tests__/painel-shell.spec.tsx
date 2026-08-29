import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { PainelShell } from '../painel-shell';
import { staffPanelClient } from '../../lib/staff-panel-client';
import { staffAuthClient } from '../../lib/staff-auth-client';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/staff/painel/vagas',
}));
vi.mock('../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterPerfil: vi.fn() },
}));
vi.mock('../../lib/staff-auth-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/staff-auth-client')>();
  return {
    ...real,
    staffAuthClient: { ...real.staffAuthClient, logout: vi.fn() },
  };
});

const PERFIL = {
  userId: 'u1',
  tenantId: 't1',
  roles: ['admin_tenant'],
  email: 'ana@empresa.example',
  razaoSocial: 'Empresa Exemplo Ltda',
};

describe('PainelShell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra perfil, trilha e conteúdo, e acende o item da rota atual', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL);

    render(
      <PainelShell breadcrumb={[{ label: 'Vagas' }]}>
        <p>Conteúdo</p>
      </PainelShell>,
    );

    await waitFor(() => expect(screen.getByText('Empresa Exemplo Ltda')).toBeInTheDocument());
    expect(within(screen.getByRole('main')).getByText('Conteúdo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vagas/ })).toHaveAttribute('aria-current', 'page');
  });

  it('passa o contador para a navegação quando informado', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL);

    render(
      <PainelShell breadcrumb={[{ label: 'Dashboard' }]} contadores={{ vagasAtivas: 9 }}>
        <p>Conteúdo</p>
      </PainelShell>,
    );

    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toHaveTextContent('9'),
    );
  });

  it('redireciona para /staff/entrar quando a sessão expirou', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockRejectedValue(
      new Error('Sessão expirada, faça login novamente'),
    );

    render(
      <PainelShell breadcrumb={[{ label: 'Dashboard' }]}>
        <p>Conteúdo</p>
      </PainelShell>,
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('encerra a sessão e redireciona ao clicar em Sair', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL);

    render(
      <PainelShell breadcrumb={[{ label: 'Dashboard' }]}>
        <p>Conteúdo</p>
      </PainelShell>,
    );

    await waitFor(() => expect(screen.getByText('Empresa Exemplo Ltda')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));

    expect(staffAuthClient.logout).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/staff/entrar');
  });

  it('não redireciona quando a falha ao obter o perfil não é de autenticação', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockRejectedValue(new Error('Erro interno do servidor'));

    render(
      <PainelShell breadcrumb={[{ label: 'Dashboard' }]}>
        <p>Conteúdo</p>
      </PainelShell>,
    );

    await waitFor(() =>
      expect(within(screen.getByRole('main')).getByText('Conteúdo')).toBeInTheDocument(),
    );

    expect(pushMock).not.toHaveBeenCalled();
  });
});
