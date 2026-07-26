import { classifyHardBlockedCategories } from '../hard-blocked-category-linter';

describe('classifyHardBlockedCategories', () => {
  it('detecta pergunta sobre gravidez', () => {
    expect(classifyHardBlockedCategories('Você está grávida ou planeja engravidar em breve?')).toContain('gravidez');
  });

  it('detecta pergunta sobre esterilização', () => {
    expect(classifyHardBlockedCategories('Você já fez laqueadura ou vasectomia?')).toContain('esterilizacao');
  });

  it('detecta exigência de teste de HIV', () => {
    expect(classifyHardBlockedCategories('Anexe o resultado do seu teste de HIV mais recente')).toContain(
      'estado_saude_filtro',
    );
  });

  it('detecta estado civil usado como filtro', () => {
    expect(classifyHardBlockedCategories('Você é casada ou pretende se casar nos próximos anos?')).toContain(
      'estado_civil_filtro',
    );
  });

  it('detecta antecedentes criminais (categoria condicional, não hard-block puro)', () => {
    expect(classifyHardBlockedCategories('Anexe sua certidão de antecedentes criminais')).toContain(
      'antecedentes_criminais',
    );
  });

  it('não classifica pergunta neutra', () => {
    expect(classifyHardBlockedCategories('Você tem CNH categoria B?')).toHaveLength(0);
  });
});
