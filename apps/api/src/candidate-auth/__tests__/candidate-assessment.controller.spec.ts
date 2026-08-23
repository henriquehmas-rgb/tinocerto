import { NotFoundException } from '@nestjs/common';
import { CandidateAssessmentController } from '../candidate-assessment.controller';

describe('CandidateAssessmentController', () => {
  let pool: { query: jest.Mock };
  let assessmentService: { responderBloco: jest.Mock; concluir: jest.Mock };
  let encryption: object;
  let controller: CandidateAssessmentController;
  const tenantContextRun = (_tenantId: string, fn: (client: unknown) => unknown) => fn(pool);

  beforeEach(() => {
    pool = { query: jest.fn() };
    assessmentService = { responderBloco: jest.fn(), concluir: jest.fn() };
    encryption = {};
    controller = new CandidateAssessmentController(pool as never, assessmentService as never, encryption as never);
    (controller as unknown as { tenantContext: { run: typeof tenantContextRun } }).tenantContext = {
      run: tenantContextRun,
    };
  });

  it('retorna 404 quando a candidatura nao pertence ao candidato autenticado', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // resolveOwnedApplicationTenant não encontra nada

    await expect(
      controller.obterBlocoAtual({ personId: 'outro-candidato' } as never, 'app-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('retorna concluido=true quando o assessment ja foi concluido', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1' }] }) // resolveOwnedApplicationTenant
      .mockResolvedValueOnce({ rows: [{ id: 'aa-1', status: 'concluido' }] }); // assessment_application

    const result = await controller.obterBlocoAtual({ personId: 'p1' } as never, 'app-1');

    expect(result).toEqual({ concluido: true });
  });

  it('retorna o bloco atual com os 2 itens e o progresso quando ha bloco pendente', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'aa-1', status: 'iniciado' }] })
      .mockResolvedValueOnce({ rows: [{ n: 20 }] }) // total de blocos
      .mockResolvedValueOnce({ rows: [{ n: 4 }] }) // blocos respondidos
      .mockResolvedValueOnce({
        rows: [
          { block_id: 'b-5', item_id: 'i-1', enunciado: 'Enunciado 1' },
          { block_id: 'b-5', item_id: 'i-2', enunciado: 'Enunciado 2' },
        ],
      });

    const result = await controller.obterBlocoAtual({ personId: 'p1' } as never, 'app-1');

    expect(result).toEqual({
      blockId: 'b-5',
      itens: [
        { itemId: 'i-1', texto: 'Enunciado 1' },
        { itemId: 'i-2', texto: 'Enunciado 2' },
      ],
      progresso: { atual: 4, total: 20 },
    });
  });

  it('responder chama responderBloco e, se ainda faltam blocos, retorna concluido=false sem chamar concluir', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1' }] }) // resolveOwnedApplicationTenant
      .mockResolvedValueOnce({ rows: [{ id: 'aa-1' }] }); // resolve assessmentApplicationId
    assessmentService.responderBloco.mockResolvedValue({ id: 'resp-1' });
    assessmentService.concluir.mockRejectedValue(new Error('Assessment aa-1 incompleto: 5 de 20 blocos respondidos'));

    const result = await controller.responder(
      { personId: 'p1' } as never,
      'app-1',
      'b-5',
      { itemIds: ['i-1', 'i-2'], maisId: 'i-1', menosId: 'i-2' } as never,
    );

    expect(result).toEqual({ concluido: false });
    expect(assessmentService.responderBloco).toHaveBeenCalled();
  });

  it('responder conclui automaticamente quando era o ultimo bloco', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'aa-1' }] });
    assessmentService.responderBloco.mockResolvedValue({ id: 'resp-1' });
    assessmentService.concluir.mockResolvedValue({
      assessmentResultId: 'ar-1',
      theta: {},
      seTheta: {},
      escoreBruto: {},
      calibracaoVersao: 'v1',
    });

    const result = await controller.responder(
      { personId: 'p1' } as never,
      'app-1',
      'b-20',
      { itemIds: ['i-39', 'i-40'], maisId: 'i-39', menosId: 'i-40' } as never,
    );

    expect(result).toEqual({ concluido: true });
  });
});
