import { BadRequestException, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CandidateAuthGuard } from '../candidate-auth/candidate-auth.guard';
import { PublicApplicationService } from './public-application.service';
import { IpRateLimit } from '../security/ip-rate-limit.decorator';
import { IpRateLimitGuard } from '../security/ip-rate-limit.guard';

interface RequestWithTenantAndCandidate extends Request {
  tenantId: string;
  personId: string;
  body: { respostasInscricao?: string };
}

@Controller('v1/public/careers/:tenantSlug')
export class PublicApplicationController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly publicApplicationService: PublicApplicationService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Achado da revisão consolidada: sem isto, flood de candidaturas +
  // upload de arquivo não tinha nenhum limite -- 20/min por IP, generoso
  // para um candidato real se candidatando a várias vagas.
  @IpRateLimit({ escopo: 'public-application-apply', limit: 20, windowSeconds: 60 })
  @Post('jobs/:jobId/apply')
  @UseGuards(CandidateAuthGuard, IpRateLimitGuard)
  @UseInterceptors(FileInterceptor('curriculo'))
  async apply(
    @Req() req: RequestWithTenantAndCandidate,
    @Param('jobId') jobId: string,
    @UploadedFile() curriculo: Express.Multer.File,
  ) {
    if (!curriculo) {
      throw new BadRequestException('Arquivo de currículo é obrigatório');
    }
    const respostasInscricao = req.body.respostasInscricao ? JSON.parse(req.body.respostasInscricao) : [];

    return this.tenantContext.run(req.tenantId, (client) =>
      this.publicApplicationService.apply(client, {
        tenantId: req.tenantId,
        jobId,
        personId: req.personId,
        curriculo: { buffer: curriculo.buffer, originalname: curriculo.originalname, mimetype: curriculo.mimetype },
        respostasInscricao,
      }),
    );
  }
}
