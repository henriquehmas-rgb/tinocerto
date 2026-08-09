import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FunilPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job-1' }), useRouter: () => routerMock }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterFunil: vi.fn(), moverEtapa: vi.fn(), obterPerfil: vi.fn() },
}));

describe('FunilPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza as colunas do funil com as candidaturas carregadas', async () => {
    // Payload moldado como o backend real retorna: JobService.funil() só inclui
    // no objeto as etapas que já têm ao menos uma candidatura -- uma vaga nova
    // com todo mundo em triagem retorna só { triagem: [...] }, sem a chave
    // 'entrevista'.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('mostra a coluna Entrevista vazia (e como destino válido pra mover) mesmo quando o funil não traz essa chave', async () => {
    // Regressão do achado I3: a correção anterior trocou a lista fixa de colunas
    // por Object.keys(funil) puro, o que fazia a coluna Entrevista desaparecer
    // (e o menu Mover ficar vazio) sempre que ninguém ainda tivesse chegado lá --
    // o caso mais comum de todos, uma vaga nova.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    expect(screen.getByText('Entrevista')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mover ana/i }));
    expect(await screen.findByRole('menuitem', { name: 'Entrevista' })).toBeInTheDocument();
  });

  it('move uma candidatura de etapa e recarrega o funil', async () => {
    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({
        entrevista: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
      });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mover ana/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entrevista' }));

    await waitFor(() =>
      expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'entrevista'),
    );
    expect(staffPanelClient.obterFunil).toHaveBeenCalledTimes(2);
  });

  it('renderiza um link para editar a vaga apontando para a rota correta', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({});
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    const link = await screen.findByRole('link', { name: 'Editar vaga' });
    expect(link).toHaveAttribute('href', '/staff/painel/vagas/job-1/editar');
  });

  it('deriva as colunas dinamicamente do funil, mostrando etapas fora da lista fixa antiga', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      oferta: [{ id: 'app-2', personId: 'person-2', nomeCandidato: 'Bruno', criadoEm: '2026-08-01T00:00:00Z' }],
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Bruno')).toBeInTheDocument());
    expect(screen.getByText('Oferta')).toBeInTheDocument();
    // As colunas padrão continuam presentes junto da etapa nova.
    expect(screen.getByText('Triagem')).toBeInTheDocument();
    expect(screen.getByText('Entrevista')).toBeInTheDocument();
  });

  it('redireciona para /staff/entrar quando o carregamento do funil falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockRejectedValue(new Error('Usuário não autenticado'));
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<FunilPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
