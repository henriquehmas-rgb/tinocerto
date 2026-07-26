import { calculatePcdQuotaPercent, calculateAprendizQuotaRange } from '../quota-calculator';

describe('calculatePcdQuotaPercent (Lei 8.213/91 art. 93)', () => {
  it('empresa com menos de 100 empregados não tem cota', () => {
    expect(calculatePcdQuotaPercent(99)).toBe(0);
  });
  it('100 a 200 empregados: 2%', () => {
    expect(calculatePcdQuotaPercent(150)).toBe(2);
  });
  it('201 a 500 empregados: 3%', () => {
    expect(calculatePcdQuotaPercent(300)).toBe(3);
  });
  it('501 a 1000 empregados: 4%', () => {
    expect(calculatePcdQuotaPercent(700)).toBe(4);
  });
  it('mais de 1000 empregados: 5%', () => {
    expect(calculatePcdQuotaPercent(1500)).toBe(5);
  });
});

describe('calculateAprendizQuotaRange (CLT art. 429)', () => {
  it('calcula faixa de 5% a 15% do quadro', () => {
    expect(calculateAprendizQuotaRange(200)).toEqual({ min: 10, max: 30 });
  });
  it('empresa muito pequena ainda assim retorna faixa proporcional', () => {
    expect(calculateAprendizQuotaRange(10)).toEqual({ min: 1, max: 2 });
  });
});
