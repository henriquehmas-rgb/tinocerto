import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renderiza um svg com um role de imagem e o rótulo acessível com o número de dias', () => {
    const { container } = render(
      <Sparkline
        pontos={[
          { data: '2026-08-01', total: 1 },
          { data: '2026-08-02', total: 3 },
          { data: '2026-08-03', total: 2 },
        ]}
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'Tendência dos últimos 3 dias');
  });

  it('desenha uma linha reta na base quando todos os dias estão zerados', () => {
    const { container } = render(
      <Sparkline
        pontos={[
          { data: '2026-08-01', total: 0 },
          { data: '2026-08-02', total: 0 },
        ]}
        altura={40}
      />,
    );

    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const pontos = polyline!.getAttribute('points')!.split(' ');
    expect(pontos.every((ponto) => ponto.endsWith(',40'))).toBe(true);
  });

  it('desenha uma linha reta no meio quando todos os dias têm o mesmo valor positivo', () => {
    const { container } = render(
      <Sparkline
        pontos={[
          { data: '2026-08-01', total: 5 },
          { data: '2026-08-02', total: 5 },
        ]}
        altura={40}
      />,
    );

    const polyline = container.querySelector('polyline');
    const pontos = polyline!.getAttribute('points')!.split(' ');
    expect(pontos.every((ponto) => ponto.endsWith(',20'))).toBe(true);
  });

  it('não quebra com um único ponto', () => {
    const { container } = render(<Sparkline pontos={[{ data: '2026-08-01', total: 5 }]} />);

    expect(container.querySelector('polyline')?.getAttribute('points')).not.toContain('NaN');
  });

  it('não renderiza nada com array vazio', () => {
    const { container } = render(<Sparkline pontos={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
