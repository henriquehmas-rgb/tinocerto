import { classifySensitiveCategories } from '../sensitive-category-linter';

describe('classifySensitiveCategories', () => {
  it('detecta convicção política (caso real Gupy/TRT-15)', () => {
    const categories = classifySensitiveCategories('Você costuma criticar autoridades quando discorda delas?');
    expect(categories).toContain('conviccao_politica');
  });

  it('detecta dado de saúde mental (caso real Gupy/TRT-15)', () => {
    const categories = classifySensitiveCategories('Você tem variações de humor com frequência?');
    expect(categories).toContain('saude');
  });

  it('detecta dificuldade para dormir como dado de saúde', () => {
    const categories = classifySensitiveCategories('Você tem dificuldade para dormir?');
    expect(categories).toContain('saude');
  });

  it('detecta religião', () => {
    const categories = classifySensitiveCategories('Qual sua religião ou crença espiritual?');
    expect(categories).toContain('religiao');
  });

  it('detecta raça/cor', () => {
    const categories = classifySensitiveCategories('Qual sua raça ou cor, segundo o IBGE?');
    expect(categories).toContain('raca');
  });

  it('detecta biometria', () => {
    const categories = classifySensitiveCategories('Autoriza captura de reconhecimento facial durante o teste?');
    expect(categories).toContain('biometria');
  });

  it('detecta vida sexual/orientação', () => {
    const categories = classifySensitiveCategories('Qual sua orientação sexual?');
    expect(categories).toContain('vida_sexual');
  });

  it('não classifica pergunta neutra de trabalho como sensível', () => {
    const categories = classifySensitiveCategories('Quantos anos de experiência você tem com Excel avançado?');
    expect(categories).toHaveLength(0);
  });

  it('detecta múltiplas categorias na mesma pergunta', () => {
    const categories = classifySensitiveCategories('Sua religião influencia seu humor ou variações emocionais?');
    expect(categories).toEqual(expect.arrayContaining(['religiao', 'saude']));
  });
});
