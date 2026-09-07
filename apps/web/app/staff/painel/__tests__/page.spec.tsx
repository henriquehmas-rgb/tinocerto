import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import PainelPage from '../page';
import { staffPanelClient } from '../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/staff/painel',
}));
vi.mock('../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterMetricas: vi.fn(), obterPerfil: vi.fn(), obterTendenciaCandidaturas: vi.fn() },
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
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockResolvedValue([
      { data: '2026-08-01', total: 1 },
      { data: '2026-08-02', total: 3 },
    ]);

    render(<PainelPage />);

    const conteudo = await waitFor(() => screen.getByRole('main'));
    await waitFor(() => expect(within(conteudo).getByText('3')).toBeInTheDocument());
    expect(within(conteudo).getByText('1')).toBeInTheDocument();
    expect(within(conteudo).getByText('7')).toBeInTheDocument();
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
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockResolvedValue([]);

    render(<PainelPage />);

    await waitFor(() => expect(screen.getByText('Criar sua primeira vaga')).toBeInTheDocument());
  });

  it('redireciona para /staff/entrar em erro de autenticação', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockRejectedValue(new Error('Sessão expirada, faça login novamente'));
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockResolvedValue([]);

    render(<PainelPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('mostra o card Por estágio ordenado (Triagem antes de Entrevista) mesmo se o objeto vier na ordem contrária', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockResolvedValue({
      vagasAtivas: 3,
      vagasRascunho: 1,
      candidaturasEmAndamento: 7,
      porEstagio: { entrevista: 2, triagem: 5 },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockResolvedValue([]);

    render(<PainelPage />);

    await waitFor(() => expect(screen.getByText('Triagem')).toBeInTheDocument());
    const rotulos = screen.getAllByText(/Triagem|Entrevista/).map((el) => el.textContent);
    expect(rotulos.indexOf('Triagem')).toBeLessThan(rotulos.indexOf('Entrevista'));
  });

  it('mostra a sparkline de novas candidaturas com o total do período', async () => {
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
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockResolvedValue([
      { data: '2026-08-01', total: 4 },
      { data: '2026-08-02', total: 6 },
    ]);

    render(<PainelPage />);

    expect(await screen.findByText('Novas candidaturas (30 dias)')).toBeInTheDocument();
    expect(await screen.findByText('10')).toBeInTheDocument();
  });

  it('trata erro ao carregar a tendência isoladamente, sem derrubar o resto do dashboard', async () => {
    vi.mocked(staffPanelClient.obterMetricas).mockResolvedValue({
      vagasAtivas: 3,
      vagasRascunho: 1,
      candidaturasEmAndamento: 7,
      porEstagio: { triagem: 5 },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });
    vi.mocked(staffPanelClient.obterTendenciaCandidaturas).mockRejectedValue(new Error('falhou'));

    render(<PainelPage />);

    expect(await screen.findByText('7')).toBeInTheDocument();
  });
});
