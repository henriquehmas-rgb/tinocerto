import React from "react";

export interface SparklinePonto {
  data: string;
  total: number;
}

export interface SparklineProps {
  pontos: SparklinePonto[];
  largura?: number;
  altura?: number;
}

export function Sparkline({ pontos, largura = 200, altura = 32 }: SparklineProps) {
  if (pontos.length === 0) return null;

  const valores = pontos.map((ponto) => ponto.total);
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const amplitude = max - min;
  const passoX = pontos.length > 1 ? largura / (pontos.length - 1) : 0;

  const coordenadas = pontos.map((ponto, indice) => {
    const x = passoX * indice;
    // amplitude 0 = todo mundo com o mesmo valor, sem denominador para
    // normalizar. Dois casos: (a) tudo zerado (max === 0, tenant sem
    // nenhuma candidatura no período) -- linha reta na base (y = altura),
    // que é a leitura visual correta de "nada aconteceu"; (b) tudo igual
    // mas positivo (ex.: 5 candidaturas todo dia) -- linha reta no meio,
    // para não parecer visualmente idêntico ao caso zerado.
    const y =
      amplitude !== 0
        ? altura - ((ponto.total - min) / amplitude) * altura
        : max === 0
          ? altura
          : altura / 2;
    return `${x},${y}`;
  });

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      width={largura}
      height={altura}
      role="img"
      aria-label={`Tendência dos últimos ${pontos.length} dias`}
    >
      <polyline
        points={coordenadas.join(" ")}
        fill="none"
        stroke="var(--pr-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
