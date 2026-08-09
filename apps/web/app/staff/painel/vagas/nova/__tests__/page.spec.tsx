import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NovaVagaPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { criarVaga: vi.fn(), obterPerfil: vi.fn() },
}));

describe('NovaVagaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({ userId: 'u1', tenantId: 't1', roles: ['recrutador'] });
  });

  it('submete o formulário e navega para a lista ao criar com sucesso', async () => {
    vi.mocked(staffPanelClient.criarVaga).mockResolvedValue({ id: 'job-1' });
    render(<NovaVagaPage />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.change(screen.getByLabelText('ID da requisição'), { target: { value: 'req-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() =>
      expect(staffPanelClient.criarVaga).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'Engenheiro de Dados', requisitionId: 'req-1' }),
      ),
    );
    expect(pushMock).toHaveBeenCalledWith('/staff/painel/vagas');
  });

  it('mostra erro quando a criação falha', async () => {
    vi.mocked(staffPanelClient.criarVaga).mockRejectedValue(new Error('Requisição não encontrada'));
    render(<NovaVagaPage />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.change(screen.getByLabelText('ID da requisição'), { target: { value: 'req-invalido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(screen.getByText('Requisição não encontrada')).toBeInTheDocument());
  });

  it('redireciona para /staff/entrar quando a checagem de perfil no carregamento detecta sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockRejectedValue(new Error('Usuário não autenticado'));
    render(<NovaVagaPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('redireciona para /staff/entrar quando criarVaga falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.criarVaga).mockRejectedValue(new Error('Usuário não autenticado'));
    render(<NovaVagaPage />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.change(screen.getByLabelText('ID da requisição'), { target: { value: 'req-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
