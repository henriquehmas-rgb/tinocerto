import { Test } from '@nestjs/testing';
import { AssessmentController } from '../assessment.controller';
import { AssessmentService } from '../assessment.service';
import { ReportService } from '../report/report.service';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('AssessmentController', () => {
  beforeAll(() => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');
  });

  async function montar(overrides: {
    assessment?: Partial<AssessmentService>;
    report?: Partial<ReportService>;
  }) {
    const poolFake = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AssessmentController],
      providers: [
        { provide: AssessmentService, useValue: overrides.assessment ?? {} },
        { provide: ReportService, useValue: overrides.report ?? {} },
        { provide: EnvelopeEncryptionService, useValue: new EnvelopeEncryptionService() },
        { provide: DatabaseService, useValue: { pool: poolFake } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(AssessmentController);
  }

  it('POST / delega para AssessmentService.convidar com o tenant do request', async () => {
    const convidar = jest.fn().mockResolvedValue({ id: 'aa-1' });
    const controller = await montar({ assessment: { convidar } as Partial<AssessmentService> });

    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as never;
    const resultado = await controller.convidar(req, {
      applicationId: 'app-1',
      personId: 'person-1',
      instrumentVersionId: 'iv-1',
    });

    expect(resultado).toEqual({ id: 'aa-1' });
    expect(convidar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-abc', applicationId: 'app-1' }),
    );
  });

  it('GET results/:id/report delega para ReportService.gerar', async () => {
    const gerar = jest.fn().mockResolvedValue({ assessmentResultId: 'r-1', secoes: [], rodape: 'x' });
    const controller = await montar({ report: { gerar } as Partial<ReportService> });

    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as never;
    const relatorio = await controller.relatorio(req, 'r-1');

    expect(relatorio.assessmentResultId).toBe('r-1');
    expect(gerar).toHaveBeenCalled();
  });

  // A resposta do POST de conclusão é a fronteira mais fácil de furar da
  // fase inteira: o serviço tem θ na mão, e devolver o objeto dele inteiro
  // custa zero linha. Só que isso abriria um segundo caminho de leitura de
  // `assessment_result` -- sem `result_grant`, sem revogação, sem
  // expiração e sem o rodapé obrigatório --, tornando a ponte de
  // consentimento decorativa. Este teste falha se alguém voltar a
  // encaminhar o retorno do serviço direto para o corpo da resposta.
  it('POST /:id/actions/complete NÃO devolve theta, SE, escore bruto nem calibração', async () => {
    const concluir = jest.fn().mockResolvedValue({
      assessmentResultId: 'r-9',
      theta: { abertura: 1.23 },
      seTheta: { abertura: 0.42 },
      escoreBruto: { abertura: 8 },
      calibracaoVersao: 'literatura_v1',
    });
    const controller = await montar({ assessment: { concluir } as Partial<AssessmentService> });

    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as never;
    const resposta = await controller.concluir(req, 'aa-1');

    expect(resposta).toEqual({
      id: 'aa-1',
      status: 'concluido',
      assessmentResultId: 'r-9',
      relatorio: '/v1/assessments/results/r-9/report',
    });

    // Asserção separada e por varredura do JSON serializado: `toEqual`
    // acima já prende a forma, mas um campo aninhado novo passaria batido
    // numa refatoração que trocasse o objeto por um DTO. O valor 1.23 é o
    // θ do mock -- se ele aparecer em qualquer lugar do corpo, vazou.
    const corpo = JSON.stringify(resposta);
    for (const proibido of ['theta', 'seTheta', 'escoreBruto', 'calibracaoVersao', '1.23']) {
      expect(corpo).not.toContain(proibido);
    }
    expect(concluir).toHaveBeenCalled();
  });
});
