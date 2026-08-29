import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConfiguracoesPage from '../page';
import { staffPanelClient } from '../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock, usePathname: () => '/staff/painel/configuracoes' }));
vi.mock('../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: {
    obterConexaoGoogleCalendar: vi.fn(),
    obterUrlAutorizacaoGoogleCalendar: vi.fn(),
    desconectarGoogleCalendar: vi.fn(),
    obterPerfil: vi.fn(),
  },
}));

const PERFIL_MOCK = {
  userId: 'u1',
  tenantId: 't1',
  roles: ['admin_tenant'],
  email: 'ana@empresa.example',
  razaoSocial: 'Empresa Exemplo Ltda',
};

describe('ConfiguracoesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o botão de conectar quando não há conexão', async () => {
    vi.mocked(staffPanelClient.obterConexaoGoogleCalendar).mockResolvedValue({ connected: false });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);

    render(<ConfiguracoesPage />);

    await waitFor(() => expect(screen.getByText('Conectar Google Calendar')).toBeInTheDocument());
  });

  it('mostra o e-mail conectado e o botão de desconectar quando já há conexão', async () => {
    vi.mocked(staffPanelClient.obterConexaoGoogleCalendar).mockResolvedValue({
      connected: true,
      googleEmail: 'ana@gmail.com',
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);

    render(<ConfiguracoesPage />);

    await waitFor(() => expect(screen.getByText('ana@gmail.com')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
  });

  it('chama desconectarGoogleCalendar ao clicar em Desconectar', async () => {
    vi.mocked(staffPanelClient.obterConexaoGoogleCalendar).mockResolvedValue({
      connected: true,
      googleEmail: 'ana@gmail.com',
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.desconectarGoogleCalendar).mockResolvedValue(undefined);

    render(<ConfiguracoesPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Desconectar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => expect(staffPanelClient.desconectarGoogleCalendar).toHaveBeenCalledTimes(1));
  });

  it('redireciona para /staff/entrar em erro de autenticação', async () => {
    vi.mocked(staffPanelClient.obterConexaoGoogleCalendar).mockRejectedValue(
      new Error('Sessão expirada, faça login novamente'),
    );
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);

    render(<ConfiguracoesPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
