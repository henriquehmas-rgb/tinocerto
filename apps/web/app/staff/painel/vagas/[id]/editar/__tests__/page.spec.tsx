import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditarVagaPage from '../page';
import { staffPanelClient } from '../../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock, useParams: () => ({ id: 'job-1' }), usePathname: () => '/staff/painel/vagas/abc-123/editar' }));
vi.mock('../../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: {
    editarVaga: vi.fn(),
    atribuirRecrutadores: vi.fn(),
    obterVaga: vi.fn(),
    obterPerfil: vi.fn(),
    obterInstrumentosAtivos: vi.fn(),
    listarEquipe: vi.fn(),
    gerarSugestaoDescricao: vi.fn(),
    aplicarSugestaoDescricao: vi.fn(),
  },
}));

const EQUIPE = [
  { id: 'r1', email: 'ana@empresa.example', papeis: ['recrutador'] },
  { id: 'r2', email: 'bruno@empresa.example', papeis: ['recrutador'] },
  { id: 'r3', email: 'carla@empresa.example', papeis: ['admin_tenant'] },
];

const vagaBase = {
  id: 'job-1',
  titulo: 'Engenheiro de Dados',
  descricao: 'Descrição da vaga',
  habilidadesExigidas: ['SQL', 'Python'],
  publicadoEm: null,
  criadoEm: '2026-08-01T00:00:00Z',
  recrutadorIds: ['r1', 'r2'],
  instrumentVersionId: null,
};

const PERFIL_MOCK = {
  userId: 'u1',
  tenantId: 't1',
  roles: ['admin_tenant'],
  email: 'ana@empresa.example',
  razaoSocial: 'Empresa Exemplo Ltda',
};

describe('EditarVagaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.listarEquipe).mockResolvedValue(EQUIPE);
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue(PERFIL_MOCK);
  });

  it('pré-preenche o formulário com os dados atuais da vaga', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Engenheiro de Dados'));
    expect(screen.getByLabelText('Descrição')).toHaveValue('Descrição da vaga');
    expect(screen.getByText('SQL')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByLabelText('ana@empresa.example')).toBeChecked();
    expect(screen.getByLabelText('bruno@empresa.example')).toBeChecked();
    expect(screen.getByLabelText('carla@empresa.example')).not.toBeChecked();
  });

  it('não chama atribuirRecrutadores quando o campo de recrutadores não é alterado ao salvar', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByLabelText('ana@empresa.example')).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(staffPanelClient.editarVaga).toHaveBeenCalled());
    expect(staffPanelClient.atribuirRecrutadores).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/staff/painel/vagas/job-1');
  });

  it('chama atribuirRecrutadores com a nova lista quando o campo de recrutadores é alterado', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);
    vi.mocked(staffPanelClient.atribuirRecrutadores).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByLabelText('carla@empresa.example')).not.toBeChecked());
    fireEvent.click(screen.getByLabelText('carla@empresa.example'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.atribuirRecrutadores).toHaveBeenCalledWith(
        'job-1',
        expect.arrayContaining(['r1', 'r2', 'r3']),
      ),
    );
    const chamada = vi.mocked(staffPanelClient.atribuirRecrutadores).mock.calls[0][1];
    expect(chamada).toHaveLength(3);
  });

  it('não chama atribuirRecrutadores quando o carregamento inicial da vaga falha (não perde ninguém por segurança)', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Vaga não encontrada'));
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await waitFor(() => expect(staffPanelClient.obterVaga).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(staffPanelClient.editarVaga).toHaveBeenCalled());
    expect(staffPanelClient.atribuirRecrutadores).not.toHaveBeenCalled();
  });

  it('mostra erro e desabilita os checkboxes de recrutadores quando o carregamento inicial da vaga falha por motivo genérico', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Erro de rede'));

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByText('Erro de rede')).toBeInTheDocument());
    await screen.findByLabelText('ana@empresa.example');
    expect(screen.getByLabelText('ana@empresa.example')).toBeDisabled();
  });

  it('não deixa a submissão passar batido sem tentar atribuir recrutadores digitados, quando o carregamento inicial falhou', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Erro de rede'));
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByText('Erro de rede')).toBeInTheDocument());
    await screen.findByLabelText('ana@empresa.example');
    expect(screen.getByLabelText('ana@empresa.example')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(staffPanelClient.editarVaga).toHaveBeenCalled());
    expect(staffPanelClient.atribuirRecrutadores).not.toHaveBeenCalled();
  });

  it('redireciona para /staff/entrar quando o carregamento da vaga falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Usuário não autenticado'));

    render(<EditarVagaPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('redireciona para /staff/entrar quando editarVaga falha por sessão expirada', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockRejectedValue(new Error('Sessão expirada, faça login novamente'));

    render(<EditarVagaPage />);
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Engenheiro de Dados'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('mostra erro quando editarVaga falha', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockRejectedValue(new Error('Vaga não encontrada'));

    render(<EditarVagaPage />);
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Engenheiro de Dados'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByText('Vaga não encontrada')).toBeInTheDocument());
  });

  it('mostra o seletor de instrumento com as opcoes ativas e envia a selecao ao salvar', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'Descricao',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([
      { id: 'iv-1', nome: 'Perfil Comportamental Tinocerto', versao: 1 },
    ]);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    const select = await screen.findByLabelText('Instrumento de assessment');
    expect(screen.getByRole('option', { name: 'Perfil Comportamental Tinocerto (v1)' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'iv-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.editarVaga).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ instrumentVersionId: 'iv-1' }),
      ),
    );
  });

  it('selecionar Nenhum numa vaga que ja tinha instrumento envia instrumentVersionId: null', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({ ...vagaBase, instrumentVersionId: 'iv-1' });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([
      { id: 'iv-1', nome: 'Perfil Comportamental Tinocerto', versao: 1 },
    ]);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    const select = await screen.findByLabelText('Instrumento de assessment');
    await waitFor(() => expect(select).toHaveValue('iv-1'));

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.editarVaga).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ instrumentVersionId: null }),
      ),
    );
  });

  it('nao envia instrumentVersionId (nem null, nem vazio) quando o carregamento inicial da vaga falha', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Erro de rede'));
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByText('Erro de rede')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(staffPanelClient.editarVaga).toHaveBeenCalled());
    const payload = vi.mocked(staffPanelClient.editarVaga).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.instrumentVersionId).toBeUndefined();
    expect(payload.instrumentVersionId).not.toBe(null);
    expect(payload.instrumentVersionId).not.toBe('');
  });

  it('mostra botao de sugerir reescrita e o diff apos gerar', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'procuramos um rapaz esforçado',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarSugestaoDescricao).mockResolvedValue({
      id: 'sug-1', jobId: 'job-1',
      textoOriginal: 'procuramos um rapaz esforçado',
      textoSugerido: 'procuramos uma pessoa esforçada',
      criadoEm: '2026-08-10T00:00:00Z',
    });

    render(<EditarVagaPage />);
    await screen.findByLabelText('Instrumento de assessment');

    fireEvent.click(screen.getByRole('button', { name: 'Sugerir reescrita' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument());
    expect(screen.getByText('rapaz')).toBeInTheDocument();
    expect(screen.getByText('pessoa')).toBeInTheDocument();
  });

  it('aplicar a sugestao atualiza o campo de descricao local', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'procuramos um rapaz esforçado',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarSugestaoDescricao).mockResolvedValue({
      id: 'sug-1', jobId: 'job-1',
      textoOriginal: 'procuramos um rapaz esforçado',
      textoSugerido: 'procuramos uma pessoa esforçada',
      criadoEm: '2026-08-10T00:00:00Z',
    });
    vi.mocked(staffPanelClient.aplicarSugestaoDescricao).mockResolvedValue({ descricao: 'procuramos uma pessoa esforçada' });

    render(<EditarVagaPage />);
    await screen.findByLabelText('Instrumento de assessment');
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir reescrita' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() =>
      expect(staffPanelClient.aplicarSugestaoDescricao).toHaveBeenCalledWith('job-1', 'sug-1'),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe('procuramos uma pessoa esforçada'),
    );
  });

  it('clicar em Sugerir reescrita nao dispara o submit do formulario de editar vaga (regressao: Button sem type explicito herdava type=submit do navegador)', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'procuramos um rapaz esforcado',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarSugestaoDescricao).mockResolvedValue({
      id: 'sug-1', jobId: 'job-1',
      textoOriginal: 'procuramos um rapaz esforcado',
      textoSugerido: 'procuramos uma pessoa esforcada',
      criadoEm: '2026-08-10T00:00:00Z',
    });

    render(<EditarVagaPage />);
    await screen.findByLabelText('Instrumento de assessment');

    fireEvent.click(screen.getByRole('button', { name: 'Sugerir reescrita' }));

    await waitFor(() => expect(staffPanelClient.gerarSugestaoDescricao).toHaveBeenCalled());
    expect(staffPanelClient.editarVaga).not.toHaveBeenCalled();
  });

  it('mostra mensagem de erro quando aplicar a sugestao falha com 409 (descricao mudou desde a geracao)', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'procuramos um rapaz esforçado',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarSugestaoDescricao).mockResolvedValue({
      id: 'sug-1', jobId: 'job-1',
      textoOriginal: 'procuramos um rapaz esforçado',
      textoSugerido: 'procuramos uma pessoa esforçada',
      criadoEm: '2026-08-10T00:00:00Z',
    });
    vi.mocked(staffPanelClient.aplicarSugestaoDescricao).mockRejectedValue(
      new Error('A descrição da vaga mudou desde que esta sugestão foi gerada.'),
    );

    render(<EditarVagaPage />);
    await screen.findByLabelText('Instrumento de assessment');
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir reescrita' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() =>
      expect(screen.getByText('A descrição da vaga mudou desde que esta sugestão foi gerada.')).toBeInTheDocument(),
    );
  });

  it('mostra mensagem de indisponibilidade quando gerar sugestao falha com 503', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue({
      id: 'job-1', titulo: 'Vaga X', descricao: 'procuramos um rapaz esforçado',
      habilidadesExigidas: [], publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z',
      recrutadorIds: [], instrumentVersionId: null,
    });
    vi.mocked(staffPanelClient.obterInstrumentosAtivos).mockResolvedValue([]);
    vi.mocked(staffPanelClient.gerarSugestaoDescricao).mockRejectedValue(
      new Error('Geração por IA indisponível no momento, tente novamente.'),
    );

    render(<EditarVagaPage />);
    await screen.findByLabelText('Instrumento de assessment');

    fireEvent.click(screen.getByRole('button', { name: 'Sugerir reescrita' }));

    await waitFor(() =>
      expect(screen.getByText('Geração por IA indisponível no momento, tente novamente.')).toBeInTheDocument(),
    );
  });

  it('atualiza as habilidades exigidas via ChipsInput', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);

    render(<EditarVagaPage />);

    await screen.findByText('SQL');
    fireEvent.click(screen.getByRole('button', { name: 'Remover Python' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.editarVaga).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ habilidadesExigidas: ['SQL'] }),
      ),
    );
  });
});
