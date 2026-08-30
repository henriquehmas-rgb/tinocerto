import { describe, expect, it } from 'vitest';
import { idadeRelativa, montarChips, resolverDestino } from '../funil-formatacao';

const AGORA = new Date('2026-08-29T12:00:00Z');

describe('idadeRelativa', () => {
  it('diz "hoje" no mesmo dia', () => {
    expect(idadeRelativa('2026-08-29T08:00:00Z', AGORA)).toBe('hoje');
  });

  it('usa singular para um dia', () => {
    expect(idadeRelativa('2026-08-28T08:00:00Z', AGORA)).toBe('há 1 dia');
  });

  it('usa plural a partir de dois dias', () => {
    expect(idadeRelativa('2026-08-26T12:00:00Z', AGORA)).toBe('há 3 dias');
  });
});

describe('montarChips', () => {
  it('traduz o status do assessment para linguagem de recrutador', () => {
    const chips = montarChips(
      { assessmentStatus: 'concluido', origemCanal: null, criadoEm: '2026-08-29T08:00:00Z' },
      AGORA,
    );
    expect(chips[0].rotulo).toBe('Assessment concluído');
  });

  it('omite o chip de assessment quando não há assessment', () => {
    const chips = montarChips(
      { assessmentStatus: null, origemCanal: null, criadoEm: '2026-08-29T08:00:00Z' },
      AGORA,
    );
    expect(chips.map((c) => c.rotulo)).toEqual(['hoje']);
  });

  it('traduz canais conhecidos e deixa desconhecidos como vieram', () => {
    const conhecido = montarChips(
      { assessmentStatus: null, origemCanal: 'site_carreiras', criadoEm: '2026-08-29T08:00:00Z' },
      AGORA,
    );
    expect(conhecido[0].rotulo).toBe('Site de carreiras');

    const desconhecido = montarChips(
      { assessmentStatus: null, origemCanal: 'feira_de_empregos', criadoEm: '2026-08-29T08:00:00Z' },
      AGORA,
    );
    expect(desconhecido[0].rotulo).toBe('feira_de_empregos');
  });

  it('a idade é sempre o último chip', () => {
    const chips = montarChips(
      { assessmentStatus: 'iniciado', origemCanal: 'site_carreiras', criadoEm: '2026-08-28T08:00:00Z' },
      AGORA,
    );
    expect(chips.map((c) => c.rotulo)).toEqual(['Assessment iniciado', 'Site de carreiras', 'há 1 dia']);
  });
});

describe('resolverDestino', () => {
  const funil = {
    triagem: [{ id: 'a1' }],
    entrevista: [{ id: 'b1' }],
  };

  it('devolve a etapa de destino quando o candidato está em outra', () => {
    expect(resolverDestino(funil, 'a1', 'entrevista')).toBe('entrevista');
  });

  it('devolve null ao soltar na coluna de origem', () => {
    // Soltar onde já estava não é um movimento -- não pode gerar chamada
    // à API nem entrada no histórico da candidatura.
    expect(resolverDestino(funil, 'a1', 'triagem')).toBeNull();
  });

  it('devolve null para candidatura desconhecida', () => {
    expect(resolverDestino(funil, 'inexistente', 'entrevista')).toBeNull();
  });
});
