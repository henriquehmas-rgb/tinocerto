import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PainelPage from '../page';
import { staffPanelClient } from '../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));
vi.mock('../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterMetricas: vi.fn(), obterPerfil: vi.fn() },
}));

describe('PainelPage (Dashboard)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra as métricas retornadas pelo client', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockResolvedValue({
      vagasAtivas: 3,
      vagasRascunho: 1,
      candidaturasEmAndamento: 7,
      porEstagio: { triagem: 5, entrevista: 2 },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<PainelPage />);

    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Empresa Exemplo Ltda')).toBeInTheDocument();
    expect(screen.getByText('ana@empresa.example')).toBeInTheDocument();
  });

  it('mostra estado vazio com CTA quando não há nenhuma vaga', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockResolvedValue({
      vagasAtivas: 0,
      vagasRascunho: 0,
      candidaturasEmAndamento: 0,
      porEstagio: {},
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<PainelPage />);

    await waitFor(() => expect(screen.getByText('Criar sua primeira vaga')).toBeInTheDocument());
  });

  it('redireciona para /staff/entrar em erro de autenticação', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockRejectedValue(new Error('Sessão expirada'));
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<PainelPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
