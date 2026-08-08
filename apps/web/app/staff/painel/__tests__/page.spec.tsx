import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PainelPage from '../page';
import { staffPanelClient } from '../../../../lib/staff-panel-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { listarVagas: vi.fn() },
}));

describe('PainelPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista as vagas retornadas pelo client', async () => {
    vi.mocked(staffPanelClient.listarVagas).mockResolvedValue([
      { id: '1', titulo: 'Engenheiro de Dados', publicadoEm: null, criadoEm: '2026-08-01T00:00:00Z' },
    ]);
    render(<PainelPage />);
    await waitFor(() => expect(screen.getByText('Engenheiro de Dados')).toBeInTheDocument());
  });

  it('mostra mensagem de vazio quando não há vagas', async () => {
    vi.mocked(staffPanelClient.listarVagas).mockResolvedValue([]);
    render(<PainelPage />);
    await waitFor(() => expect(screen.getByText('Nenhum item encontrado')).toBeInTheDocument());
  });
});
