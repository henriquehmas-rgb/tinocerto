import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MyApplicationsPage from '../page';
import { candidateAuthClient } from '../../../../lib/candidate-auth-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../../../../lib/candidate-auth-client', () => ({
  candidateAuthClient: {
    isLoggedIn: vi.fn(() => true),
    authenticatedFetch: vi.fn(),
  },
}));

describe('MyApplicationsPage', () => {
  it('cada candidatura e um link para a pagina de detalhe', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { applicationId: 'app-1', jobTitulo: 'Vaga X', etapaFunil: 'triagem', reprovadoEm: null },
        ]),
    } as Response);

    render(<MyApplicationsPage />);

    await waitFor(() => expect(screen.getByText('Vaga X')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Vaga X/ })).toHaveAttribute('href', '/candidato/candidaturas/app-1');
  });
});
