import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditarVagaPage from '../page';
import { staffPanelClient } from '../../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock, useParams: () => ({ id: 'job-1' }) }));
vi.mock('../../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { editarVaga: vi.fn(), atribuirRecrutadores: vi.fn(), obterVaga: vi.fn() },
}));

const vagaBase = {
  id: 'job-1',
  titulo: 'Engenheiro de Dados',
  descricao: 'Descrição da vaga',
  habilidadesExigidas: ['SQL', 'Python'],
  publicadoEm: null,
  criadoEm: '2026-08-01T00:00:00Z',
  recrutadorIds: ['r1', 'r2'],
};

describe('EditarVagaPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pré-preenche o formulário com os dados atuais da vaga', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Engenheiro de Dados'));
    expect(screen.getByLabelText('Descrição')).toHaveValue('Descrição da vaga');
    expect(screen.getByLabelText('Habilidades exigidas (separadas por vírgula)')).toHaveValue('SQL, Python');
    expect(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)')).toHaveValue('r1, r2');
  });

  it('não chama atribuirRecrutadores quando o campo de recrutadores não é alterado ao salvar', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockResolvedValue(vagaBase);
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);
    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)')).toHaveValue('r1, r2'));
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

    await waitFor(() => expect(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)')).toHaveValue('r1, r2'));
    fireEvent.change(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)'), {
      target: { value: 'r1, r2, r3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.atribuirRecrutadores).toHaveBeenCalledWith('job-1', ['r1', 'r2', 'r3']),
    );
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

  it('mostra erro e desabilita o campo de recrutadores quando o carregamento inicial da vaga falha por motivo genérico', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Erro de rede'));
    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByText('Erro de rede')).toBeInTheDocument());
    expect(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)')).toBeDisabled();
  });

  it('não deixa a submissão passar batido sem tentar atribuir recrutadores digitados, quando o carregamento inicial falhou', async () => {
    vi.mocked(staffPanelClient.obterVaga).mockRejectedValue(new Error('Erro de rede'));
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);
    render(<EditarVagaPage />);

    await waitFor(() => expect(screen.getByText('Erro de rede')).toBeInTheDocument());
    const campoRecrutadores = screen.getByLabelText('IDs dos recrutadores (separados por vírgula)');
    expect(campoRecrutadores).toBeDisabled();

    // Como o campo está desabilitado, o usuário não consegue digitar nele --
    // mesmo assim, garantimos que submeter não chama atribuirRecrutadores
    // silenciosamente com um valor que pareça ter sido confirmado.
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
});
