import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ApplyPage from '../page';
import { candidateAuthClient } from '../../../../../../lib/candidate-auth-client';

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ tenantSlug: 'empresa-teste', jobSlug: 'vaga-teste' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));
vi.mock('../../../../../../lib/candidate-auth-client', () => ({
  candidateAuthClient: {
    isLoggedIn: vi.fn(() => true),
    authenticatedFetch: vi.fn(),
  },
}));

const JOB_DETAIL = {
  id: 'job-1',
  titulo: 'Vaga Teste',
  camposCustomizados: [],
};

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

async function preencherESubmeterFormulario() {
  await waitFor(() => expect(screen.getByText('Candidatar-se: Vaga Teste')).toBeInTheDocument());
  const curriculoInput = screen.getByLabelText('Currículo (PDF)') as HTMLInputElement;
  const arquivo = new File(['%PDF-1.4'], 'curriculo.pdf', { type: 'application/pdf' });
  fireEvent.change(curriculoInput, { target: { files: [arquivo] } });
  // O input de currículo tem `required` (restaurado -- ver achado de
  // revisão final sobre a validação nativa do navegador). jsdom nunca
  // limpa `validity.valueMissing` de um input type=file mesmo depois de
  // `fireEvent.change` setar `.files` -- então clicar no botão de submit
  // (que passa pelo algoritmo nativo de submissão do form, incluindo
  // validação interativa) bloquearia o submit aqui mesmo com o arquivo já
  // preenchido. Disparar o evento 'submit' diretamente no form pula esse
  // algoritmo nativo e vai direto pro onSubmit do React, que é o que este
  // teste quer exercitar -- a validação real do navegador continua valendo
  // fora do ambiente de teste.
  fireEvent.submit(screen.getByRole('button', { name: 'Enviar candidatura' }).closest('form')!);
}

describe('ApplyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, JOB_DETAIL));
  });

  it('redireciona para a tela de assessment quando a resposta traz assessmentId', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockJsonResponse(200, { applicationId: 'app-1', assessmentId: 'assess-1' }),
    );

    render(<ApplyPage />);
    await preencherESubmeterFormulario();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/candidato/candidaturas/app-1/assessment'));
  });

  it('redireciona para minhas candidaturas quando a resposta traz assessmentId nulo', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockJsonResponse(200, { applicationId: 'app-1', assessmentId: null }),
    );

    render(<ApplyPage />);
    await preencherESubmeterFormulario();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/candidato/candidaturas'));
  });
});
