import { ResumeStructuringService } from '../resume-structuring.service';
import { locateVerbatimOffset } from '../locate-verbatim-offset';

const TEXTO_CURRICULO = `
CARLOS EDUARDO LIMA

EXPERIÊNCIA PROFISSIONAL
Analista de Operações Pleno na Empresa Exemplo Ltda, de janeiro de 2020 a março de 2023.
Responsável por otimização de processos logísticos e gestão de equipe de 5 pessoas.

FORMAÇÃO
Bacharelado em Administração pela Universidade Federal Exemplo, concluído em 2019.

HABILIDADES
Excel avançado, gestão de projetos, liderança de equipes.
`.trim();

describe('ResumeStructuringService', () => {
  // Chamada real à API da Claude -- exceção deliberada ao padrão "sem mock"
  // do projeto (Postgres/Redis/MinIO são serviços locais gratuitos; a API
  // da Claude é paga e não-determinística por natureza). Pula com aviso
  // claro se ANTHROPIC_API_KEY não estiver configurada, em vez de mockar a
  // resposta e nunca testar a integração de verdade.
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const maybeIt = hasApiKey ? it : it.skip;

  if (!hasApiKey) {
    console.warn('ANTHROPIC_API_KEY ausente -- pulando teste de integração real com a Claude API (ResumeStructuringService)');
  }

  maybeIt('estrutura um currículo real e cada citacaoVerbatim é localizável no texto original', async () => {
    const service = new ResumeStructuringService();
    const resultado = await service.structure(TEXTO_CURRICULO);

    expect(resultado.experiencias.length).toBeGreaterThan(0);
    expect(resultado.formacao.length).toBeGreaterThan(0);

    const todosItens = [...resultado.experiencias, ...resultado.formacao, ...resultado.habilidades];
    for (const item of todosItens) {
      const offset = locateVerbatimOffset(TEXTO_CURRICULO, item.citacaoVerbatim);
      expect(offset).not.toBeNull();
    }
  }, 30000);
});
