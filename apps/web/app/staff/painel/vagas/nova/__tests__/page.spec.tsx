import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NovaVagaPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { criarVaga: vi.fn() },
}));

describe('NovaVagaPage', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(pushMock).toHaveBeenCalledWith('/staff/painel');
  });

  it('mostra erro quando a criação falha', async () => {
    vi.mocked(staffPanelClient.criarVaga).mockRejectedValue(new Error('Requisição não encontrada'));
    render(<NovaVagaPage />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.change(screen.getByLabelText('ID da requisição'), { target: { value: 'req-invalido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(screen.getByText('Requisição não encontrada')).toBeInTheDocument());
  });
});
