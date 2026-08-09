import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CandidaturaPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }) }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterRelatorioAssessment: vi.fn() },
}));

describe('CandidaturaPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o score de aderência e as dimensões do relatório quando disponíveis', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({
      relatorio: { secoes: [{ dimensao: 'conscienciosidade', titulo: 'Conscienciosidade', estimativaTheta: 0.6 }] },
      aderencia: { scoreAderencia: 0.8, skillsBatidas: ['SQL'], skillsFaltantes: ['Python'] },
    });
    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument());
    expect(screen.getByText('Conscienciosidade')).toBeInTheDocument();
  });

  it('mostra mensagem apropriada quando o assessment ainda não foi concluído', async () => {
    vi.mocked(staffPanelClient.obterRelatorioAssessment).mockResolvedValue({ relatorio: null, aderencia: null });
    render(<CandidaturaPage />);
    await waitFor(() => expect(screen.getByText('Assessment ainda não concluído')).toBeInTheDocument());
  });
});
