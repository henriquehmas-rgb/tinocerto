import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PublicApplicationController, CURRICULO_MAX_BYTES } from '../public-application.controller';
import { PublicApplicationService } from '../public-application.service';
import { DatabaseService } from '../../database/database.service';
import { CandidateAuthGuard } from '../../candidate-auth/candidate-auth.guard';
import { IpRateLimitGuard } from '../../security/ip-rate-limit.guard';

// Achado da revisão consolidada: FileInterceptor('curriculo', { limits })
// só recusa upload grande de fato durante o parse real de multipart --
// chamar o método do controller diretamente (como os outros specs de
// controller da base fazem) não exercita o Multer. Este spec sobe um app
// Nest de verdade em uma porta efêmera e bate nele com fetch/FormData
// nativos do Node (sem depender de supertest, que não é dependência
// deste projeto).
class FakeCandidateAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.tenantId = 'tenant-teste';
    req.personId = 'person-teste';
    return true;
  }
}

class FakeIpRateLimitGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('PublicApplicationController (limite de tamanho do curriculo)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let applyMock: jest.Mock;

  beforeAll(async () => {
    applyMock = jest.fn().mockResolvedValue({ applicationId: 'application-1' });

    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicApplicationController],
      providers: [
        { provide: PublicApplicationService, useValue: { apply: applyMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CandidateAuthGuard)
      .useValue(new FakeCandidateAuthGuard())
      .overrideGuard(IpRateLimitGuard)
      .useValue(new FakeIpRateLimitGuard())
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterEach(() => {
    applyMock.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejeita com 413 um curriculo maior que o limite antes de processar', async () => {
    const arquivoGrande = Buffer.alloc(CURRICULO_MAX_BYTES + 1, 1);
    const form = new FormData();
    form.append('curriculo', new Blob([arquivoGrande], { type: 'application/pdf' }), 'curriculo.pdf');

    const response = await fetch(`${baseUrl}/v1/public/careers/empresa-teste/jobs/job-1/apply`, {
      method: 'POST',
      body: form,
    });

    // NestJS converte o MulterError de tamanho excedido numa
    // PayloadTooLargeException (413) automaticamente -- ver comentario
    // no controller. E uma resposta clara e estruturada, nao um 500
    // generico, entao 413 (nao 400) e o resultado correto aqui.
    expect(response.status).toBe(413);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('aceita curriculo dentro do limite e delega ao service', async () => {
    const arquivoPequeno = Buffer.from('%PDF-1.4\nconteudo pequeno de teste');
    const form = new FormData();
    form.append('curriculo', new Blob([arquivoPequeno], { type: 'application/pdf' }), 'curriculo.pdf');

    const response = await fetch(`${baseUrl}/v1/public/careers/empresa-teste/jobs/job-1/apply`, {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(201);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});
