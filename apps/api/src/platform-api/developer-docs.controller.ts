// apps/api/src/platform-api/developer-docs.controller.ts
import { Controller, Get, Header } from '@nestjs/common';

// Página HTML mínima, escrita à mão -- aponta só para os dois assets
// locais servidos pelo ServeStaticModule acima. Sem framework de
// templating, sem build step novo: é exatamente o "quase-zero-código"
// que a design spec pede (decisão 3).
const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <title>Tinocerto — Documentação da API</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <script id="api-reference" data-url="/v1/developer/openapi-spec/openapi.yaml"></script>
    <script src="/v1/developer/docs/assets/standalone.js"></script>
  </body>
</html>`;

@Controller('v1/developer/docs')
export class DeveloperDocsController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return DOCS_HTML;
  }
}
