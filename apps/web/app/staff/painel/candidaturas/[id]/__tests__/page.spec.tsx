import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    obterScorecards: vi.fn(),
    submeterScorecard: vi.fn(),
    obterOfertas: vi.fn(),
    estenderOferta: vi.fn(),
    aceitarOferta: vi.fn(),
    recusarOferta: vi.fn(),
    gerarResumoCandidato: vi.fn(),
    obterResumoCandidatoAtual: vi.fn(),
    aplicarResumoCandidato: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterResumoCandidatoAtual).mockResolvedValue(null);
  });

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

  it('envia avaliadorIds com o id do usuário logado ao agendar a entrevista', async () => {
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
    vi.mocked(staffPanelClient.agendarEntrevista).mockResolvedValue(undefined);

    render(<CandidaturaPage />);

    const input = await screen.findByLabelText('Data e hora');
    fireEvent.change(input, { target: { value: '2026-09-01T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agendar entrevista' }));

    await waitFor(() =>
      expect(staffPanelClient.agendarEntrevista).toHaveBeenCalledWith(
        expect.objectContaining({ avaliadorIds: ['u1'] }),
      ),
    );
  });

  const ROTEIRO_COM_COMPETENCIA = {
    id: 'guide-1',
    status: 'publicado' as const,
    publishedVersionId: 'version-1',
    competencias: [
      {
        competencyId: 'comp-1',
        nome: 'Comunicação',
        ancoras: [
          { nivel: 1, descricaoComportamental: 'Não se comunica com clareza' },
          { nivel: 2, descricaoComportamental: 'Comunica-se com dificuldade' },
          { nivel: 3, descricaoComportamental: 'Comunica-se adequadamente' },
          { nivel: 4, descricaoComportamental: 'Comunica-se com clareza' },
          { nivel: 5, descricaoComportamental: 'Comunica-se com excelência' },
        ],
      },
    ],
  };

  it('nao mostra bloco de avaliacao quando nao ha agendamento', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(ROTEIRO_COM_COMPETENCIA);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue(null);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar entrevista' })).toBeInTheDocument());
    expect(screen.queryByText('Avaliação da entrevista')).not.toBeInTheDocument();
  });

  it('mostra formulario de avaliacao com as ancoras da competencia quando ha agendamento e ainda nao enviei minha nota', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(ROTEIRO_COM_COMPETENCIA);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });
    vi.mocked(staffPanelClient.obterScorecards).mockResolvedValue([]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Avaliação da entrevista')).toBeInTheDocument());
    expect(screen.getByText('Comunica-se com excelência')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar avaliação' })).toBeDisabled();
  });

  it('envia a avaliacao com a nota escolhida por competencia e mostra o estado enviado', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(ROTEIRO_COM_COMPETENCIA);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });
    vi.mocked(staffPanelClient.obterScorecards)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'scorecard-1',
          interviewScheduleId: 'schedule-1',
          avaliadorId: 'u1',
          notasPorCompetencia: { 'comp-1': 5 },
          comentario: 'Excelente candidato',
          submetidoEm: '2026-09-01T15:00:00Z',
        },
      ]);
    vi.mocked(staffPanelClient.submeterScorecard).mockResolvedValue(undefined);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Comunica-se com excelência')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Comunica-se com excelência'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    await waitFor(() =>
      expect(staffPanelClient.submeterScorecard).toHaveBeenCalledWith('schedule-1', {
        notasPorCompetencia: { 'comp-1': 5 },
        comentario: undefined,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enviar avaliação' })).not.toBeInTheDocument());
    expect(screen.getByText('Comunica-se com excelência')).toBeInTheDocument();
  });

  it('mostra minha avaliacao ja enviada em modo leitura sem formulario', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(ROTEIRO_COM_COMPETENCIA);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });
    vi.mocked(staffPanelClient.obterScorecards).mockResolvedValue([
      {
        id: 'scorecard-1',
        interviewScheduleId: 'schedule-1',
        avaliadorId: 'u1',
        notasPorCompetencia: { 'comp-1': 4 },
        comentario: null,
        submetidoEm: '2026-09-01T15:00:00Z',
      },
    ]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Comunica-se com clareza')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Enviar avaliação' })).not.toBeInTheDocument();
  });

  it('mostra mensagem clara quando o backend recusa por eu nao ser avaliador desta entrevista', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(ROTEIRO_COM_COMPETENCIA);
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });
    vi.mocked(staffPanelClient.obterScorecards).mockResolvedValue([]);
    vi.mocked(staffPanelClient.submeterScorecard).mockRejectedValue(
      new Error('Você não é avaliador desta entrevista.'),
    );

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Comunica-se com excelência')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Comunica-se com excelência'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    await waitFor(() => expect(screen.getByText('Você não é avaliador desta entrevista.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Enviar avaliação' })).not.toBeInTheDocument();
  });

  it('nao mostra formulario de avaliacao em branco antes do perfil carregar', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue({
      id: 'app-1', jobId: 'job-1', etapaFunil: 'entrevista', criadoEm: '2026-08-01T00:00:00Z',
      person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
    });
    let resolverPerfil: (p: typeof PERFIL_MOCK) => void = () => {};
    vi.mocked(staffPanelClient.obterPerfil).mockReturnValue(
      new Promise((resolve) => { resolverPerfil = resolve; }),
    );
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1', competencias: [{ competencyId: 'comp-1', nome: 'Comunicação', ancoras: [
        { nivel: 1, descricaoComportamental: 'a' }, { nivel: 2, descricaoComportamental: 'b' },
        { nivel: 3, descricaoComportamental: 'c' }, { nivel: 4, descricaoComportamental: 'd' },
        { nivel: 5, descricaoComportamental: 'e' },
      ] }],
    });
    vi.mocked(staffPanelClient.obterAgendaEntrevista).mockResolvedValue({
      id: 'schedule-1', dataHora: '2026-09-01T14:00:00Z', status: 'agendada',
    });
    vi.mocked(staffPanelClient.obterScorecards).mockResolvedValue([]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Avaliação da entrevista')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Enviar avaliação' })).not.toBeInTheDocument();

    resolverPerfil(PERFIL_MOCK);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar avaliação' })).toBeInTheDocument());
  });

  const CANDIDATURA_TRIAGEM = {
    id: 'app-1', jobId: 'job-1', etapaFunil: 'triagem', criadoEm: '2026-08-01T00:00:00Z',
    person: { id: 'p1', nome: 'Fulano', emailPrincipal: 'fulano@example.com' },
  };

  it('mostra formulario de estender oferta quando nao ha oferta pendente', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Estender oferta' })).toBeInTheDocument());
  });

  it('envia a oferta com o valor informado', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'estendida', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: null, respondidoEm: null, motivoRecusaCodigo: null },
      ]);
    vi.mocked(staffPanelClient.estenderOferta).mockResolvedValue({ id: 'offer-1' });

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Estender oferta' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('8500.00'), { target: { value: '8500.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Estender oferta' }));

    await waitFor(() =>
      expect(staffPanelClient.estenderOferta).toHaveBeenCalledWith('app-1', { valor: '8500.00' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeInTheDocument());
  });

  it('mostra botoes de aceite e recusa quando ha oferta pendente, e nao mostra o formulario de estender', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([
      { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'estendida', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: null, respondidoEm: null, motivoRecusaCodigo: null },
    ]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Registrar recusa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estender oferta' })).not.toBeInTheDocument();
  });

  it('registrar aceite pede confirmacao e chama o endpoint', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas)
      .mockResolvedValueOnce([
        { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'estendida', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: null, respondidoEm: null, motivoRecusaCodigo: null },
      ])
      .mockResolvedValueOnce([
        { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'aceita', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: 'u1', respondidoEm: '2026-08-11T10:00:00Z', motivoRecusaCodigo: null },
      ]);
    vi.mocked(staffPanelClient.aceitarOferta).mockResolvedValue({ id: 'offer-1', applicationId: 'app-1' });

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Registrar aceite' }));

    await waitFor(() => expect(staffPanelClient.aceitarOferta).toHaveBeenCalledWith('offer-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Registrar aceite' })).not.toBeInTheDocument());
  });

  it('nao chama o endpoint de aceite se a confirmacao for cancelada', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([
      { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'estendida', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: null, respondidoEm: null, motivoRecusaCodigo: null },
    ]);

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Registrar aceite' }));

    await waitFor(() => expect(staffPanelClient.aceitarOferta).not.toHaveBeenCalled());
  });

  it('mostra o historico de ofertas anteriores', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([
      { id: 'offer-2', applicationId: 'app-1', valor: '9000.00', moeda: 'BRL', status: 'estendida', estendidoPor: 'u1', estendidoEm: '2026-08-12T10:00:00Z', respondidoPor: null, respondidoEm: null, motivoRecusaCodigo: null },
      { id: 'offer-1', applicationId: 'app-1', valor: '8500.00', moeda: 'BRL', status: 'recusada', estendidoPor: 'u1', estendidoEm: '2026-08-10T10:00:00Z', respondidoPor: 'u1', respondidoEm: '2026-08-11T10:00:00Z', motivoRecusaCodigo: null },
    ]);

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Histórico')).toBeInTheDocument());
    expect(screen.getByText(/recusada/)).toBeInTheDocument();
  });

  it('mostra o resumo vigente ao carregar, se ja existir um aplicado', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterResumoCandidatoAtual).mockResolvedValue({
      id: 'draft-1', applicationId: 'app-1',
      frases: [{ texto: 'Tem 5 anos de experiência em vendas.', fonteId: 'experiencia:0', secao: 'experiencia', itemIndex: 0, citacaoVerbatim: '5 anos como vendedor na Acme' }],
      criadoEm: '2026-08-10T00:00:00Z',
    });

    render(<CandidaturaPage />);

    await waitFor(() => expect(screen.getByText('Tem 5 anos de experiência em vendas.')).toBeInTheDocument());
    expect(screen.getByText('5 anos como vendedor na Acme')).toBeInTheDocument();
  });

  it('gerar resumo produz um rascunho com botao de aplicar', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterResumoCandidatoAtual).mockResolvedValue(null);
    vi.mocked(staffPanelClient.gerarResumoCandidato).mockResolvedValue({
      id: 'draft-2', applicationId: 'app-1',
      frases: [{ texto: 'Formado em Administração.', fonteId: 'formacao:0', secao: 'formacao', itemIndex: 0, citacaoVerbatim: 'Bacharel em Administração pela USP' }],
      criadoEm: '2026-08-10T00:00:00Z',
    });

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar resumo' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Gerar resumo' }));

    await waitFor(() => expect(screen.getByText('Formado em Administração.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Aplicar resumo' })).toBeInTheDocument();
  });

  it('erro 422 ao gerar mostra mensagem amigavel', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    vi.mocked(staffPanelClient.obterCandidatura).mockResolvedValue(CANDIDATURA_TRIAGEM);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterOfertas).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterResumoCandidatoAtual).mockResolvedValue(null);
    vi.mocked(staffPanelClient.gerarResumoCandidato).mockRejectedValue(
      new Error('Não foi possível gerar um resumo citável para este candidato agora.'),
    );

    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar resumo' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Gerar resumo' }));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível gerar um resumo citável para este candidato agora.')).toBeInTheDocument(),
    );
  });
});

