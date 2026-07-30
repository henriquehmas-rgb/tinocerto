import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guarda permanente contra colisão de CNPJ de fixture entre arquivos de spec.
 *
 * `tenant.cnpj` e `tenant.slug` são UNIQUE. Cada arquivo de spec cria seus
 * próprios tenants com um CNPJ literal e limpa no afterAll. Enquanto a limpeza
 * de todo mundo funciona e o jest roda com `maxWorkers: 1` (serializado por
 * arquivo), dois arquivos usando o MESMO CNPJ convivem por acidente -- o
 * primeiro apaga sua linha antes do segundo inserir a dele.
 *
 * O acidente acaba assim que qualquer coisa impede a limpeza de rodar: uma
 * asserção que falha antes do DELETE, um timeout, um kill do processo. A linha
 * órfã fica no banco e a próxima rodada quebra em `duplicate key value violates
 * unique constraint "tenant_cnpj_key"` -- num arquivo SEM RELAÇÃO NENHUMA com
 * o que realmente falhou, o que manda quem for investigar para o lugar errado.
 *
 * Este projeto já corrigiu essa mesma classe de bug CINCO vezes, sempre do
 * mesmo jeito: achar a colisão do dia e renumerar aquele fixture para "o
 * próximo valor livre". Dois dos arquivos corrigidos assim colidiram DE NOVO
 * depois (os comentários deles ainda dizem "trocado para o próximo valor
 * livre"), porque renumerar à mão não tem como saber o que os outros arquivos
 * escolheram. Este teste é a correção durável: em vez de consertar a colisão
 * do dia, ele torna impossível uma nova entrar sem alguém ver.
 */
describe('unicidade de CNPJ de fixture entre arquivos de spec', () => {
  const SRC_ROOT = path.resolve(__dirname, '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, out);
      } else if (entry.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  // Casa só INSERT real em `tenant` que carregue um CNPJ literal de 14
  // dígitos -- ignora comentários que mencionem um CNPJ (vários arquivos
  // documentam a correção antiga citando o valor velho, e isso não reserva
  // nada no banco).
  const INSERT_TENANT_CNPJ = /INSERT\s+INTO\s+tenant\b[^;`]*?'(\d{14})'/gis;

  function collectUses(): Map<string, Set<string>> {
    const uses = new Map<string, Set<string>>();
    for (const file of walk(SRC_ROOT)) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(INSERT_TENANT_CNPJ)) {
        const cnpj = match[1];
        const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
        if (!uses.has(cnpj)) uses.set(cnpj, new Set());
        uses.get(cnpj)!.add(rel);
      }
    }
    return uses;
  }

  it('nenhum CNPJ de fixture é usado por mais de um arquivo de spec', () => {
    const uses = collectUses();

    const collisions = [...uses.entries()]
      .filter(([, files]) => files.size > 1)
      .map(([cnpj, files]) => `${cnpj} usado por: ${[...files].sort().join(', ')}`)
      .sort();

    expect(collisions).toEqual([]);
  });

  it('a varredura acima não é vácua — de fato encontra fixtures de tenant no repo', () => {
    // Sem esta guarda, um erro no regex ou no caminho de varredura faria o
    // teste acima passar com uma lista vazia por acidente, não porque os
    // fixtures estão únicos.
    const uses = collectUses();
    expect(uses.size).toBeGreaterThan(20);
  });
});
