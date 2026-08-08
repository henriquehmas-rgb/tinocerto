import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreChart } from '../ScoreChart';

describe('ScoreChart', () => {
  it('renderiza o score geral e uma barra por dimensão', () => {
    render(
      <ScoreChart
        scoreGeral={0.75}
        dimensoes={[
          { dimensao: 'conscienciosidade', titulo: 'Conscienciosidade', estimativaTheta: 0.6 },
          { dimensao: 'extroversao', titulo: 'Extroversão', estimativaTheta: -0.2 },
        ]}
      />,
    );
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Conscienciosidade')).toBeInTheDocument();
    expect(screen.getByText('Extroversão')).toBeInTheDocument();
  });

  it('mostra mensagem apropriada quando scoreGeral é null (sem assessment ainda)', () => {
    render(<ScoreChart scoreGeral={null} dimensoes={[]} />);
    expect(screen.getByText('Assessment ainda não concluído')).toBeInTheDocument();
  });
});
