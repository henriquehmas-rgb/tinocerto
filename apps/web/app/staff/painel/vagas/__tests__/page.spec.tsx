import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import VagasPage from '../page';
import { staffPanelClient } from '../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/staff/painel/vagas',
}));
vi.mock('../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { listarVagas: vi.fn(), obterPerfil: vi.fn() },
}));

describe('VagasPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista as vagas retornadas pelo client, com contagem de candidaturas', async () => {
    vi.mocked(staffPanelClient.listarVagas).mockResolvedValue([
      { id: '1', titulo: 'Engenheiro de Dados', publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z', contagemCandidaturas: 4 },
    ]);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<VagasPage />);

    await waitFor(() => expect(screen.getByText('Engenheiro de Dados')).toBeInTheDocument());
    expect(screen.getByText('4 candidatura(s)')).toBeInTheDocument();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
  });

  it('mostra estado vazio com CTA quando não há vagas', async () => {
    vi.mocked(staffPanelClient.listarVagas).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<VagasPage />);

    await waitFor(() => expect(screen.getByText('Criar sua primeira vaga')).toBeInTheDocument());
  });

  it('redireciona para /staff/entrar em erro de autenticação', async () => {
    vi.mocked(staffPanelClient.listarVagas).mockRejectedValue(new Error('Sessão expirada, faça login novamente'));
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<VagasPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
