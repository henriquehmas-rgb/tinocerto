import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CandidaturaPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }), useRouter: () => routerMock }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: {
    obterRelatorioAssessment: vi.fn(),
    obterCandidatura: vi.fn(),
    obterPerfil: vi.fn(),
    obterRoteiroEntrevista: vi.fn(),
    obterAgendaEntrevista: vi.fn(),
    agendarEntrevista: vi.fn(),
  },
}));

const PERFIL_MOCK = {
  userId: 'u1',
  tenantId: 't1',
  roles: ['admin_tenant'],
  email: 'ana@empresa.example',
  razaoSocial: 'Empresa Exemplo Ltda',
};

describe('CandidaturaPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o score de aderência e as dimensões do relatório quando disponíveis', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({
      relatorio: { secoes: [{ dimensao: 'conscienciosidade', titulo: 'Conscienciosidade', estimativaTheta: 0.6 }] },
      aderencia: { scoreAderencia: 80, skillsBatidas: ['SQL'], skillsFaltantes: ['Python'] },
    });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1',
      jobId: 'job-1',
      etapaFunil: 'entrevista',
      criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'person-1', nome: 'Ana Souza', emailPrincipal: 'ana@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument());
    expect(screen.getByText('Conscienciosidade')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Etapa atual: entrevista')).toBeInTheDocument();
    expect(screen.getByText('SQL')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
  });

  it('mostra mensagem apropriada quando o assessment ainda não foi concluído', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1',
      jobId: 'job-1',
      etapaFunil: 'triagem',
      criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'person-1', nome: 'Bruno Lima', emailPrincipal: 'bruno@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByText('Assessment ainda não concluído')).toBeInTheDocument());
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
  });

  it('redireciona para /staff/entrar quando o carregamento falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockRejectedValue(new Error('Usuário não autenticado'));
    vi.mocked(staffPanelClient.obterCandidatura).mockRejectedValue(new Error('Usuário não autenticado'));
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin_tenant'],
      email: 'ana@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });

    render(<CandidaturaPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('não mostra bloco de agendamento quando a etapa não é entrevista', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'triagem', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Fulano')).toBeInTheDocument());
    expect(screen.queryByText('Agendar entrevista')).not.toBeInTheDocument();
  });

  it('mostra aviso pra publicar o roteiro quando a vaga ainda não tem um publicado', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue(null);

    render(<CandidaturaPage />);

    await waitFor(() =>
      expect(screen.getByText('Publique o roteiro de entrevista na vaga antes de agendar')).toBeInTheDocument(),
    );
  });

  it('mostra formulário de agendar quando há roteiro publicado e nenhum agendamento ainda', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1', competencias: [],
    });
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue(null);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar entrevista' })).toBeInTheDocument());
  });

  it('mostra data/hora e status quando já existe agendamento', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1', competencias: [],
    });
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('agendada', { exact: false })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Agendar entrevista' })).not.toBeInTheDocument();
  });
});