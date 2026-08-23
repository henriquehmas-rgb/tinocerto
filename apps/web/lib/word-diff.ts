export interface DiffPart {
  texto: string;
  tipo: 'igual' | 'removido' | 'adicionado';
}

// Diff palavra-a-palavra simples (LCS clássico), suficiente para reescritas
// de descrição de vaga -- não precisa de biblioteca de diff, o texto é
// curto (algumas centenas de palavras no máximo) e a saída só precisa
// destacar visualmente o que mudou, não produzir um patch aplicável.
export function wordDiff(original: string, sugerido: string): DiffPart[] {
  const palavrasA = original.split(/(\s+)/).filter((p) => p.length > 0);
  const palavrasB = sugerido.split(/(\s+)/).filter((p) => p.length > 0);

  const m = palavrasA.length;
  const n = palavrasB.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i][j] = palavrasA[i - 1] === palavrasB[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  const resultado: DiffPart[] = [];
  let i = m;
  let j = n;
  const reverso: DiffPart[] = [];
  while (i > 0 && j > 0) {
    if (palavrasA[i - 1] === palavrasB[j - 1]) {
      reverso.push({ texto: palavrasA[i - 1], tipo: 'igual' });
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      reverso.push({ texto: palavrasA[i - 1], tipo: 'removido' });
      i--;
    } else {
      reverso.push({ texto: palavrasB[j - 1], tipo: 'adicionado' });
      j--;
    }
  }
  while (i > 0) {
    reverso.push({ texto: palavrasA[i - 1], tipo: 'removido' });
    i--;
  }
  while (j > 0) {
    reverso.push({ texto: palavrasB[j - 1], tipo: 'adicionado' });
    j--;
  }
  reverso.reverse().forEach((p) => resultado.push(p));
  return resultado;
}
