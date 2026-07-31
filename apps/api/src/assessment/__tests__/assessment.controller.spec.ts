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

  it('GET /:id/report delega para ReportService.gerar', async () => {
    const gerar = jest.fn().mockResolvedValue({ assessmentResultId: 'r-1', secoes: [], rodape: 'x' });
    const controller = await montar({ report: { gerar } as Partial<ReportService> });

    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as never;
    const relatorio = await controller.relatorio(req, 'r-1');

    expect(relatorio.assessmentResultId).toBe('r-1');
    expect(gerar).toHaveBeenCalled();
  });
});
