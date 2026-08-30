import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FunilPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job-1' }), useRouter: () => routerMock, usePathname: () => '/staff/painel/vagas/abc-123' }));
const PERFIL_MOCK = {  userId: 'u1',  tenantId: 't1',  roles: ['admin_tenant'],  email: 'ana@empresa.example',  razaoSocial: 'Empresa Exemplo Ltda',};
const VAGA_MOCK = {
  id: 'job-1',
  titulo: 'Vaga X',
  descricao: '',
  habilidadesExigidas: [],
  publicadoEm: null,
  criadoEm: '2026-08-01T00:00:00Z',
  recrutadorIds: [],
  instrumentVersionId: null,
};// jsdom não tem um DataTransfer nativo. CandidateCard grava o payload da
// candidatura no dragstart (setData) e KanbanColumn lê de volta no drop
// (getData) -- este fake reproduz esse contrato mínimo pra simular um
// arrasto de ponta a ponta, o mesmo objeto passando pelos dois eventos
// como aconteceria de verdade no navegador.
function criarDataTransferFake() {
  const dados: Record<string, string> = {};
  return {
    setData: (tipo: string, valor: string) => {
      dados[tipo] = valor;
    },
    getData: (tipo: string) => dados[tipo] ?? '',
    get types() {
      return Object.keys(dados);
    },
  };
}

vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: {
    obterFunil: vi.fn(),
    moverEtapa: vi.fn(),
    obterPerfil: vi.fn(),
    obterVaga: vi.fn(),
    obterRoteiroEntrevista: vi.fn(),
    gerarRoteiroEntrevista: vi.fn(),
    publicarRoteiroEntrevista: vi.fn(),
    obterImpactoAdverso: vi.fn(),
    gerarPerguntasEntrevista: vi.fn(),
  },
}));


describe('FunilPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A visão preferida (kanban/tabela) persiste em localStorage entre
    // renders -- sem limpar aqui, um teste que troca de visão vaza esse
    // estado pro próximo teste que rodar em seguida, ficando dependente
    // da ordem dos testes no arquivo.
    window.localStorage.clear();
    // Provide default mock returns for new methods
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1',
      titulo: 'Vaga de teste',
      descricao: 'Descricao de teste',
      habilidadesExigidas: [],
      publicadoEm: null,
      criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: ['u1'],
      instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);
    vi.mocked(staffPanelClient.gerarRoteiroEntrevista).mockResolvedValue({ id: 'guide-1' });
    vi.mocked(staffPanelClient.publicarRoteiroEntrevista).mockResolvedValue({ id: 'guide-1', versao: 1 });
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([]);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
  });

  it('renderiza as colunas do funil com as candidaturas carregadas', async () => {
    // Payload moldado como o backend real retorna: JobService.funil() só inclui
    // no objeto as etapas que já têm ao menos uma candidatura -- uma vaga nova
    // com todo mundo em triagem retorna só { triagem: [...] }, sem a chave
    // 'entrevista'.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z', assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
      },
      conversao: { triagem: null },
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
      funil: {
        triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z', assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
      },
      conversao: { triagem: null },
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
        funil: {
          triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z', assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
        },
        conversao: { triagem: null },
      })
      .mockResolvedValueOnce({
        funil: {
          entrevista: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z', assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
        },
        conversao: { entrevista: null },
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
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
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
      funil: {
        oferta: [{ id: 'app-2', personId: 'person-2', nomeCandidato: 'Bruno', criadoEm: '2026-08-01T00:00:00Z', assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
      },
      conversao: { oferta: null },
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


  it('mostra botão de gerar roteiro quando a vaga ainda não tem nenhum', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'Descrição da vaga X',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z', recrutadorIds: [],
      instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByText('Gerar roteiro de entrevista')).toBeInTheDocument());
  });

  it('mostra botão de publicar quando o roteiro está em rascunho', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'Descrição da vaga X',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z', recrutadorIds: [],
      instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'rascunho', publishedVersionId: null,
      competencias: [{ competencyId: 'comp-1', nome: 'Comunicação', ancoras: [{ nivel: 1, descricaoComportamental: 'Não se comunica bem' }] }],
    });

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByText('Comunicação')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeInTheDocument();
  });

  it('mostra badge "Publicado" quando o roteiro já foi publicado', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'Descrição da vaga X',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z', recrutadorIds: [],
      instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1',
      competencias: [{ competencyId: 'comp-1', nome: 'Liderança', ancoras: [] }],
    });

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByText('Publicado')).toBeInTheDocument());
  });

  it('mostra mensagem de dado insuficiente quando nao ha impacto adverso calculado', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(VAGA_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([]);

    render(<FunilPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Ainda não há dados suficientes para calcular impacto adverso nesta vaga (mínimo de 5 candidaturas por grupo).'),
      ).toBeInTheDocument(),
    );
  });

  it('agrupa por etapa e dimensao, e mostra badge de alerta para razao abaixo de 0.8', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(VAGA_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([
      { etapa: 'triagem', grupoDemografico: 'genero:feminino', taxaSelecao: 0.4, razao4Quintos: 0.65, calculadoEm: '2026-08-10T00:00:00Z' },
      { etapa: 'triagem', grupoDemografico: 'genero:masculino', taxaSelecao: 0.6, razao4Quintos: 1.0, calculadoEm: '2026-08-10T00:00:00Z' },
    ]);

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByText('feminino')).toBeInTheDocument());
    expect(screen.getByText('masculino')).toBeInTheDocument();
    expect(screen.getByText('Abaixo de 0,8')).toBeInTheDocument();
  });

  it('botao de sugerir perguntas fica desabilitado sem roteiro publicado', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(VAGA_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue(null);
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([]);

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar roteiro de entrevista' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Sugerir perguntas' })).not.toBeInTheDocument();
  });

  it('gera e mostra perguntas agrupadas por competencia quando o roteiro esta publicado', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(VAGA_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1',
      competencias: [{ competencyId: 'comp-1', nome: 'Comunicação', ancoras: [] }],
    });
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarPerguntasEntrevista).mockResolvedValue({
      id: 'sug-1', interviewGuideVersionId: 'version-1',
      itens: [{ competencyId: 'comp-1', nome: 'Comunicação', perguntas: ['Conte uma situação em que precisou explicar algo complexo.'] }],
      criadoEm: '2026-08-10T00:00:00Z',
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir perguntas' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Sugerir perguntas' }));

    await waitFor(() =>
      expect(screen.getByText('Conte uma situação em que precisou explicar algo complexo.')).toBeInTheDocument(),
    );
  });

  it('mostra mensagem de indisponibilidade quando gerar perguntas falha com 503', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ funil: {}, conversao: {} });
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(VAGA_MOCK);
    vi.mocked(staffPanelClient.obterRoteiroEntrevista).mockResolvedValue({
      id: 'guide-1', status: 'publicado', publishedVersionId: 'version-1',
      competencias: [{ competencyId: 'comp-1', nome: 'Comunicação', ancoras: [] }],
    });
    vi.mocked(staffPanelClient.obterImpactoAdverso).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarPerguntasEntrevista).mockRejectedValue(
      new Error('Geração por IA indisponível no momento, tente novamente.'),
    );

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sugerir perguntas' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Sugerir perguntas' }));

    await waitFor(() =>
      expect(screen.getByText('Geração por IA indisponível no momento, tente novamente.')).toBeInTheDocument(),
    );
  });

  it('mostra o card do candidato com chips e sem fit quando não há score', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          {
            id: 'app-1',
            personId: 'p-1',
            nomeCandidato: 'Ana Souza',
            criadoEm: new Date().toISOString(),
            assessmentStatus: 'concluido',
            origemCanal: 'site_carreiras',
            scoreAderencia: null,
          },
        ],
      },
      conversao: { triagem: null },
    });

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());
    expect(screen.getByText('Assessment concluído')).toBeInTheDocument();
    expect(screen.getByText('Site de carreiras')).toBeInTheDocument();
    expect(screen.queryByTestId('fit')).toBeNull();
  });

  it('mostra o fit quando a API devolve score', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          {
            id: 'app-1',
            personId: 'p-1',
            nomeCandidato: 'Ana Souza',
            criadoEm: new Date().toISOString(),
            assessmentStatus: null,
            origemCanal: null,
            scoreAderencia: 72,
          },
        ],
      },
      conversao: { triagem: null },
    });

    render(<FunilPage />);

    await waitFor(() => expect(screen.getByTestId('fit')).toHaveTextContent('72'));
  });

  it('passa a conversão de uma etapa devolvida pela API para a coluna correspondente do Kanban (achado F4: única linha que liga esse campo à tela -- os outros 18 testes deste arquivo só usam conversao null/{})', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          {
            id: 'app-1',
            personId: 'p-1',
            nomeCandidato: 'Ana Souza',
            criadoEm: new Date().toISOString(),
            assessmentStatus: null,
            origemCanal: null,
            scoreAderencia: null,
          },
        ],
      },
      conversao: { triagem: 40 },
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());

    const triagem = screen.getByTestId('coluna-triagem');
    expect(within(triagem).getByTestId('conversao')).toHaveTextContent('40%');
  });

  it('volta o card para a coluna de origem quando mover falha', async () => {
    // Movimento otimista: o card muda de coluna antes da resposta. Se a API
    // recusar, ele precisa voltar -- senão a tela mente sobre o estado real.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          {
            id: 'app-1',
            personId: 'p-1',
            nomeCandidato: 'Ana Souza',
            criadoEm: new Date().toISOString(),
            assessmentStatus: null,
            origemCanal: null,
            scoreAderencia: null,
          },
        ],
        entrevista: [],
      },
      conversao: { triagem: null, entrevista: null },
    });
    vi.mocked(staffPanelClient.moverEtapa).mockRejectedValue(new Error('Transição não permitida'));

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());

    const dataTransfer = criarDataTransferFake();
    fireEvent.dragStart(screen.getByTestId('candidate-card'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('coluna-entrevista'), { dataTransfer });

    await waitFor(() => expect(screen.getByText('Transição não permitida')).toBeInTheDocument());
    const triagem = screen.getByTestId('coluna-triagem');
    expect(within(triagem).getByText('Ana Souza')).toBeInTheDocument();
  });

  it('limpa a mensagem de erro de um movimento anterior quando um movimento seguinte tem sucesso (achado F6: sem isto, "Transição não permitida" ficava na tela pra sempre)', async () => {
    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        funil: {
          triagem: [
            {
              id: 'app-1',
              personId: 'p-1',
              nomeCandidato: 'Ana Souza',
              criadoEm: new Date().toISOString(),
              assessmentStatus: null,
              origemCanal: null,
              scoreAderencia: null,
            },
          ],
          entrevista: [],
        },
        conversao: { triagem: null, entrevista: null },
      })
      .mockResolvedValueOnce({
        funil: {
          triagem: [],
          entrevista: [
            {
              id: 'app-1',
              personId: 'p-1',
              nomeCandidato: 'Ana Souza',
              criadoEm: new Date().toISOString(),
              assessmentStatus: null,
              origemCanal: null,
              scoreAderencia: null,
            },
          ],
        },
        conversao: { triagem: null, entrevista: null },
      });
    vi.mocked(staffPanelClient.moverEtapa)
      .mockRejectedValueOnce(new Error('Transição não permitida'))
      .mockResolvedValueOnce(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());

    const primeiroArrasto = criarDataTransferFake();
    fireEvent.dragStart(screen.getByTestId('candidate-card'), { dataTransfer: primeiroArrasto });
    fireEvent.drop(screen.getByTestId('coluna-entrevista'), { dataTransfer: primeiroArrasto });
    await waitFor(() => expect(screen.getByText('Transição não permitida')).toBeInTheDocument());

    const segundoArrasto = criarDataTransferFake();
    fireEvent.dragStart(screen.getByTestId('candidate-card'), { dataTransfer: segundoArrasto });
    fireEvent.drop(screen.getByTestId('coluna-entrevista'), { dataTransfer: segundoArrasto });

    await waitFor(() => expect(screen.queryByText('Transição não permitida')).toBeNull());
  });

  it('linka o nome do candidato no card para a página de detalhe da candidatura', async () => {
    // Regressão: o funil é a tela de trabalho do recrutador, e o nome no
    // card era o único caminho até o detalhe da candidatura (scorecards,
    // entrevistas, oferta). O componente CandidateCard do design system
    // passou a renderizar o nome como <span> plano -- sem esse teste, a
    // perda do link não derruba nenhum outro teste.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          {
            id: 'app-1',
            personId: 'p-1',
            nomeCandidato: 'Ana Souza',
            criadoEm: new Date().toISOString(),
            assessmentStatus: null,
            origemCanal: null,
            scoreAderencia: null,
          },
        ],
      },
      conversao: { triagem: null },
    });

    render(<FunilPage />);

    const link = await screen.findByRole('link', { name: 'Ana Souza' });
    expect(link).toHaveAttribute('href', '/staff/painel/candidaturas/app-1');
  });

  it('alterna para a visao de tabela e mostra as candidaturas em linhas', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana Souza', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
      },
      conversao: { triagem: null },
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).getByText('Ana Souza')).toBeInTheDocument();
  });

  it('a visao escolhida persiste em localStorage e sobrevive a recarregar', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: { triagem: [] },
      conversao: { triagem: null },
    });

    const { unmount } = render(<FunilPage />);
    await waitFor(() => expect(staffPanelClient.obterFunil).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    unmount();

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
  });

  it('selecionar candidaturas e mover em lote chama a API sequencialmente e mostra toast', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
        entrevista: [],
      },
      conversao: { triagem: null, entrevista: null },
    });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const linhaAna = screen.getByText('Ana').closest('tr')!;
    const linhaBruno = screen.getByText('Bruno').closest('tr')!;
    fireEvent.click(within(linhaAna).getByRole('checkbox'));
    fireEvent.click(within(linhaBruno).getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));

    await waitFor(() => expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(2));
    expect(staffPanelClient.moverEtapa).toHaveBeenNthCalledWith(1, 'app-1', 'entrevista');
    expect(staffPanelClient.moverEtapa).toHaveBeenNthCalledWith(2, 'app-2', 'entrevista');
    expect(screen.getByRole('status')).toHaveTextContent('2 movidos');
  });

  it('desfazer devolve cada candidatura a sua propria etapa anterior', async () => {
    // Ana em triagem e Bruno em oferta -- os dois PRECISAM mover pra
    // entrevista (nenhum já está lá), senão o filtro do achado F2 (que
    // pula quem já está na etapa de destino) descartaria Bruno da conta.
    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        funil: {
          triagem: [{ id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
          entrevista: [],
          oferta: [{ id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null }],
        },
        conversao: { triagem: null, entrevista: null, oferta: null },
      })
      .mockResolvedValue({
        funil: {
          triagem: [],
          oferta: [],
          entrevista: [
            { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
            { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          ],
        },
        conversao: { triagem: null, entrevista: null, oferta: null },
      });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Bruno').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 movidos'));

    vi.mocked(staffPanelClient.moverEtapa).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /desfazer/i }));

    await waitFor(() => expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(2));
    // Ana estava em triagem, Bruno estava em oferta -- cada um volta
    // pra ETAPA PRÓPRIA, não pra uma etapa comum.
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'triagem');
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-2', 'oferta');
  });

  it('mover em lote nunca tem mais de uma chamada a API em andamento por vez (achado F1)', async () => {
    // Regressão: um teste que só checa a ORDEM das chamadas (toHaveBeenNthCalledWith)
    // não prova sequencialidade -- .map() + Promise.allSettled produz a mesma
    // ordem de chamadas, só que todas disparadas antes de qualquer await
    // resolver. Este teste torna o paralelismo observável contando quantas
    // chamadas a moverEtapa estão em andamento (iniciadas e ainda não
    // resolvidas) a cada instante.
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
        entrevista: [
          { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
        oferta: [],
      },
      conversao: { triagem: null, entrevista: null, oferta: null },
    });

    let emAndamento = 0;
    let maxEmAndamento = 0;
    vi.mocked(staffPanelClient.moverEtapa).mockImplementation(async () => {
      emAndamento++;
      maxEmAndamento = Math.max(maxEmAndamento, emAndamento);
      await new Promise((resolve) => setTimeout(resolve, 5));
      emAndamento--;
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Bruno').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^oferta$/i }));

    await waitFor(() => expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(2));
    expect(maxEmAndamento).toBe(1);
  });

  it('lote ignora candidaturas já na etapa de destino, mesmo quando outras do lote precisam mover (achado F2)', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
        entrevista: [
          { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          { id: 'app-3', personId: 'p-3', nomeCandidato: 'Carla', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
      },
      conversao: { triagem: null, entrevista: null },
    });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Bruno').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Carla').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));

    // Só Ana (triagem) precisava mover -- Bruno e Carla já estavam em
    // entrevista, então não geram chamada nenhuma nem entram na contagem.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 movidos'));
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(1);
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'entrevista');
  });

  it('lote inteiro já na etapa de destino não chama a API nem mostra toast (achado F2)', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
      },
      conversao: { triagem: null },
    });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Bruno').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^triagem$/i }));

    // A seleção some (otimista) mesmo quando não havia nada pra mover de
    // verdade -- é esse desaparecimento que sinaliza "processado".
    await waitFor(() => expect(screen.queryByText('2 selecionados')).toBeNull());
    expect(staffPanelClient.moverEtapa).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('desfazer após lote parcial só reenvia quem realmente moveu, não quem falhou (achado F3)', async () => {
    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        funil: {
          triagem: [
            { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
            { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          ],
          entrevista: [],
        },
        conversao: { triagem: null, entrevista: null },
      })
      .mockResolvedValue({
        funil: {
          triagem: [
            { id: 'app-2', personId: 'p-2', nomeCandidato: 'Bruno', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          ],
          entrevista: [
            { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
          ],
        },
        conversao: { triagem: null, entrevista: null },
      });
    // app-1 (Ana) move com sucesso, app-2 (Bruno) falha -- nunca sai de
    // triagem de verdade.
    vi.mocked(staffPanelClient.moverEtapa).mockImplementation(async (id: unknown) => {
      if (id === 'app-2') throw new Error('Transição não permitida');
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(within(screen.getByText('Bruno').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 movidos, 1 falharam'));

    vi.mocked(staffPanelClient.moverEtapa).mockClear();
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: /desfazer/i }));

    // Só Ana (quem moveu de verdade) volta -- Bruno nunca saiu de triagem,
    // então mandar ele "de volta" pra lá seria uma transição fantasma.
    await waitFor(() => expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(1));
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'triagem');
  });

  it('trocar de tabela para kanban limpa a seleção e fecha o menu de lote (achado F4)', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
      },
      conversao: { triagem: null },
    });

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('1 selecionado')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    expect(screen.getByRole('button', { name: /^triagem$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /visão em kanban/i }));

    expect(screen.queryByText('1 selecionado')).toBeNull();
    expect(screen.queryByRole('button', { name: /mover etapa/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^triagem$/i })).toBeNull();
  });

  it('clicar "Desfazer" duas vezes rápido só dispara um conjunto de chamadas (achado F6)', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      funil: {
        triagem: [
          { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date().toISOString(), assessmentStatus: null, origemCanal: null, scoreAderencia: null },
        ],
        entrevista: [],
      },
      conversao: { triagem: null, entrevista: null },
    });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Ana').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 movidos'));

    vi.mocked(staffPanelClient.moverEtapa).mockClear();
    const botaoDesfazer = screen.getByRole('button', { name: /desfazer/i });
    fireEvent.click(botaoDesfazer);
    fireEvent.click(botaoDesfazer);

    await waitFor(() => expect(staffPanelClient.moverEtapa).toHaveBeenCalledTimes(1));
    expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'triagem');
    // O toast (e o botão "Desfazer" junto) some assim que o primeiro
    // clique é processado -- não sobra nada pra um segundo clique acionar.
    expect(screen.queryByRole('button', { name: /desfazer/i })).toBeNull();
  });

  it('página corrente é reduzida quando um refetch encolhe o total de páginas (achado F7)', async () => {
    const candidatura = (i: number) => ({
      id: `app-${i}`,
      personId: `p-${i}`,
      nomeCandidato: `Candidato ${i}`,
      criadoEm: new Date().toISOString(),
      assessmentStatus: null,
      origemCanal: null,
      scoreAderencia: null,
    });
    const muitasCandidaturas = Array.from({ length: 26 }, (_, i) => candidatura(i + 1));

    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        funil: { triagem: muitasCandidaturas, entrevista: [] },
        conversao: { triagem: null, entrevista: null },
      })
      .mockResolvedValue({
        funil: { triagem: [candidatura(1)], entrevista: [] },
        conversao: { triagem: null, entrevista: null },
      });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);

    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Candidato 1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /visão em tabela/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    // Vai pra página 2, onde só o 26º candidato aparece (25 por página).
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anterior' })).not.toBeDisabled());
    await waitFor(() => expect(screen.getByText('Candidato 26')).toBeInTheDocument());

    fireEvent.click(within(screen.getByText('Candidato 26').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /mover etapa/i }));
    fireEvent.click(screen.getByRole('button', { name: /^entrevista$/i }));

    // O refetch devolve só 1 candidatura no total (1 página) -- a página 2
    // em que o recrutador estava não existe mais, e precisa voltar pra 1.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled());
  });

});
