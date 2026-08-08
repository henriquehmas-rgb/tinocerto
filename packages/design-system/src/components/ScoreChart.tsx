import React from 'react';

export interface DimensaoScore {
  dimensao: string;
  titulo: string;
  estimativaTheta: number;
}

export interface ScoreChartProps {
  scoreGeral: number | null;
  dimensoes: DimensaoScore[];
}

/** estimativaTheta é um valor MFC Thurstoniano, tipicamente em torno de [-3, 3] -- normalizado aqui para uma barra 0-100%. */
function thetaParaPercentual(theta: number): number {
  const clamped = Math.max(-3, Math.min(3, theta));
  return Math.round(((clamped + 3) / 6) * 100);
}

export function ScoreChart({ scoreGeral, dimensoes }: ScoreChartProps) {
  if (scoreGeral === null) {
    return <p className="font-ui text-sm text-text-secondary">Assessment ainda não concluído</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-ui text-xs text-text-secondary">Score de aderência</p>
        <p className="font-display text-2xl text-text">{Math.round(scoreGeral * 100)}%</p>
      </div>
      <div className="flex flex-col gap-2">
        {dimensoes.map((dimensao) => (
          <div key={dimensao.dimensao}>
            <p className="font-ui text-sm text-text mb-1">{dimensao.titulo}</p>
            <div className="h-2 rounded-control bg-surface border border-border overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${thetaParaPercentual(dimensao.estimativaTheta)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
