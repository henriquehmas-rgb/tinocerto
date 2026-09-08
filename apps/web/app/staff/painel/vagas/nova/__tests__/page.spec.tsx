import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NovaVagaPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useRouter: () => routerMock, usePathname: () => '/staff/painel/vagas/nova' }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: {
    criarVaga: vi.fn(),
    obterPerfil: vi.fn(),
    listarRequisicoes: vi.fn(),
    listarEquipe: vi.fn(),
  },
}));

const UMA_REQUISICAO_APROVADA = [{ id: 'req-1', titulo: 'Requisição inicial', status: 'aprovada' as const }];
const DUAS_REQUISICOES_APROVADAS = [
  { id: 'req-1', titulo: 'Requisição inicial', status: 'aprovada' as const },
  { id: 'req-2', titulo: 'Requisição de expansão', status: 'aprovada' as const },
];
const EQUIPE = [
  { id: 'u1', email: 'ana@empresa.example', papeis: ['recrutador'] },
  { id: 'u2', email: 'bruno@empresa.example', papeis: ['admin_tenant'] },
];

describe('NovaVagaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffPanelClient.obterPerfil).mockResolvedValue({
      userId: 'u1',
      tenantId: 't1',
      roles: ['recrutador'],
      email: 'staff-logado@empresa.example',
      razaoSocial: 'Empresa Exemplo Ltda',
    });
    vi.mocked(staffPanelClient.listarEquipe).mockResolvedValue(EQUIPE);
  });

  it('não mostra o aviso de "nenhuma requisição aprovada" enquanto a busca ainda está em andamento (achado F1 da revisão)', async () => {
    let resolverRequisicoes: (valor: unknown) => void = () => {};
    const promessaRequisicoes = new Promise((resolve) => {
      resolverRequisicoes = resolve;
    });
    vi.mocked(staffPanelClient.listarRequisicoes).mockReturnValue(promessaRequisicoes as never);

    render(<NovaVagaPage />);

    expect(screen.queryByText(/nenhuma requisição aprovada/i)).not.toBeInTheDocument();

    resolverRequisicoes(UMA_REQUISICAO_APROVADA);
    // findAllByText (não findByText): mesmo caso do BubbleSelect do Radix
    // documentado nos outros testes deste arquivo -- duplica 'Requisição
    // inicial' no DOM (span visível + <option> espelhado oculto).
    await screen.findAllByText('Requisição inicial');
  });

  it('pré-seleciona a única requisição aprovada quando há só uma', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);
    vi.mocked(staffPanelClient.criarVaga).mockResolvedValue({ id: 'job-1' });

    render(<NovaVagaPage />);

    // findAllByText (não findByText): o Select do design-system, ao ficar
    // dentro de um <form>, monta um <select> nativo oculto (Radix
    // "BubbleSelect", aria-hidden) espelhando o rótulo da opção selecionada
    // para suportar autofill/submit nativo -- isso duplica o texto visível
    // no DOM. O findByText simples falha com "multiple elements"; usamos
    // findAllByText só como barreira de espera pelo carregamento, sem
    // depender de quantos elementos batem.
    await screen.findAllByText('Requisição inicial');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() =>
      expect(staffPanelClient.criarVaga).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'Engenheiro de Dados', requisitionId: 'req-1' }),
      ),
    );
  });

  it('exige escolha explícita quando há mais de uma requisição aprovada', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(DUAS_REQUISICOES_APROVADAS);
    vi.mocked(staffPanelClient.criarVaga).mockResolvedValue({ id: 'job-1' });

    render(<NovaVagaPage />);

    await screen.findAllByText('Requisição inicial');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    // Sem requisição escolhida (mais de uma opção, nenhuma pré-selecionada):
    // criarVaga não deve ter sido chamado, e uma mensagem inline explica
    // por quê -- o componente Select (Radix) não é um <select> nativo, não
    // participa de validação HTML (required não bloqueia o submit sozinho),
    // então a checagem é explícita em handleSubmit.
    expect(staffPanelClient.criarVaga).not.toHaveBeenCalled();
    expect(await screen.findByText('Selecione uma requisição')).toBeInTheDocument();
  });

  it('marca os recrutadores selecionados e envia recrutadorIds ao criar', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);
    vi.mocked(staffPanelClient.criarVaga).mockResolvedValue({ id: 'job-1' });

    render(<NovaVagaPage />);

    await screen.findByText('ana@empresa.example');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByLabelText('bruno@empresa.example'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() =>
      expect(staffPanelClient.criarVaga).toHaveBeenCalledWith(
        expect.objectContaining({ recrutadorIds: ['u2'] }),
      ),
    );
  });

  it('mostra aviso quando não há nenhuma requisição aprovada', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue([
      { id: 'req-1', titulo: 'Requisição aberta', status: 'aberta' },
    ]);

    render(<NovaVagaPage />);

    expect(await screen.findByText(/nenhuma requisição aprovada/i)).toBeInTheDocument();
  });

  it('redireciona para /staff/painel/vagas/{id}/editar ao criar com sucesso', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);
    vi.mocked(staffPanelClient.criarVaga).mockResolvedValue({ id: 'job-novo-1' });

    render(<NovaVagaPage />);

    await screen.findAllByText('Requisição inicial');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/painel/vagas/job-novo-1/editar'));
  });

  it('mostra erro quando a criação falha', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);
    vi.mocked(staffPanelClient.criarVaga).mockRejectedValue(new Error('Requisição não encontrada'));

    render(<NovaVagaPage />);

    await screen.findAllByText('Requisição inicial');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(screen.getByText('Requisição não encontrada')).toBeInTheDocument());
  });

  it('redireciona para /staff/entrar quando a checagem de perfil no carregamento detecta sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterPerfil).mockRejectedValue(new Error('Usuário não autenticado'));
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);

    render(<NovaVagaPage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });

  it('redireciona para /staff/entrar quando criarVaga falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.listarRequisicoes).mockResolvedValue(UMA_REQUISICAO_APROVADA);
    vi.mocked(staffPanelClient.criarVaga).mockRejectedValue(new Error('Usuário não autenticado'));

    render(<NovaVagaPage />);

    await screen.findAllByText('Requisição inicial');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar vaga' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});
