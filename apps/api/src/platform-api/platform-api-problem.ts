import { HttpException } from '@nestjs/common';

export const PROBLEM_BASE_URL = 'https://developers.tinocerto.com.br/problems';

interface PlatformApiProblemBody {
  status: number;
  typeSlug: string;
  title: string;
  detail: string;
  extensions: Record<string, unknown>;
}

// Toda rejeição da Plataforma API que precisa de um `type`/extensões RFC
// 9457 específicos passa por aqui -- nunca lança Error genérico nem
// HttpException do Nest sem forma dedicada nas rotas novas desta fatia.
export class PlatformApiProblem extends HttpException {
  constructor(status: number, typeSlug: string, title: string, detail: string, extensions: Record<string, unknown> = {}) {
    super({ status, typeSlug, title, detail, extensions } satisfies PlatformApiProblemBody, status);
  }

  getProblemBody(): PlatformApiProblemBody {
    return this.getResponse() as PlatformApiProblemBody;
  }
}
