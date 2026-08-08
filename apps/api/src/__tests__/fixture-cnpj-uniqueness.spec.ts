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
 *
 * SEXTA ocorrência da classe -- e a primeira em que esta guarda foi CÚMPLICE.
 * Um spec passou o CNPJ como ARGUMENTO de um helper, `criarTenant('...49')`,
 * em vez de colar o literal dentro do INSERT. A varredura só enxergava o
 * literal grudado no INSERT (a classe de caractere `[^;\`]` para no primeiro
 * backtick, ou seja, no fim do template da query parametrizada), então as
 * duas reservas daquele arquivo nunca entraram no mapa de colisão -- e a
 * guarda seguiu verde, sustentada pelos outros 46 arquivos. Uma guarda cega é
 * pior que guarda nenhuma: dá o carimbo sem fazer a checagem. Daí as duas
 * mudanças abaixo -- a varredura por literal e, principalmente, o teste de
 * NÃO-CEGUEIRA por arquivo, que falha para QUALQUER forma futura de esconder
 * um CNPJ da varredura, inclusive as que ninguém previu aqui.
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

  // Casa o literal colado dentro do INSERT -- a forma mais comum no repo.
  const INSERT_TENANT_CNPJ = /INSERT\s+INTO\s+tenant\b[^;`]*?'(\d{14})'/gis;

  // O arquivo cria tenant? Só nesses arquivos um literal reserva alguma coisa.
  const CRIA_TENANT = /INSERT\s+INTO\s+tenant\b/is;

  // Qualquer literal de 14 dígitos dentro de um arquivo que cria tenant. Pega
  // a forma que a versão anterior desta guarda não via: CNPJ passado como
  // argumento de helper, guardado em constante, ou listado em array.
  const CNPJ_LITERAL = /["'`](\d{14})["'`]/g;

  // Ignora comentários que mencionem um CNPJ: vários arquivos documentam a
  // correção antiga citando o valor velho, e citar não reserva nada no banco.
  // Sem esta poda, 5 pares de arquivos apareceriam como colisão só por causa
  // dos comentários. O `[^:]` antes do `//` preserva URLs (`postgresql://`).
  function semComentarios(texto: string): string {
    return texto
      .split('\n')
      .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
      .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');
  }

  function cnpjsDoArquivo(texto: string): Set<string> {
    const achados = new Set<string>();
    for (const match of texto.matchAll(INSERT_TENANT_CNPJ)) achados.add(match[1]);
    if (CRIA_TENANT.test(texto)) {
      for (const match of semComentarios(texto).matchAll(CNPJ_LITERAL)) achados.add(match[1]);
    }
    return achados;
  }

  function arquivos(): { rel: string; texto: string }[] {
    return walk(SRC_ROOT).map((full) => ({
      rel: path.relative(SRC_ROOT, full).split(path.sep).join('/'),
      texto: readFileSync(full, 'utf-8'),
    }));
  }

  function collectUses(): Map<string, Set<string>> {
    const uses = new Map<string, Set<string>>();
    for (const { rel, texto } of arquivos()) {
      for (const cnpj of cnpjsDoArquivo(texto)) {
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

  // Arquivos de PRODUÇÃO que inserem em `tenant` com um CNPJ genuinamente
  // dinâmico (dado real de usuário, não fixture de teste) -- a premissa
  // inteira desta guarda (todo CNPJ que entra em `tenant` durante os testes
  // devia ser um literal reservável) não se aplica aqui: não há nenhum
  // literal correto para colar, porque o valor só existe em produção. Lista
  // explícita e reduzida de propósito -- cada entrada precisa do MESMO
  // escrutínio de uma exceção de segurança, nunca adicionada só para calar
  // a guarda. StaffOnboardingService (Task 4 da autenticação de staff) é a
  // primeira -- e até aqui, única -- rota de produção que cria tenant; toda
  // criação de tenant antes disso era só teste/SQL manual.
  const PRODUCAO_CNPJ_DINAMICO = new Set(['staff-auth/staff-onboarding.service.ts']);

  it('todo arquivo que cria tenant tem pelo menos um CNPJ visível à varredura', () => {
    // A guarda de vacuidade acima é AGREGADA, e por isso não protege nada:
    // 46 arquivos visíveis escondem 1 invisível sem mover o número. Esta é
    // POR ARQUIVO, e é a que fecha o buraco de verdade -- se um spec insere
    // em `tenant` mas nenhum CNPJ dele entra no mapa, as reservas dele não
    // estão sendo checadas contra ninguém e o próximo spec pode escolher o
    // mesmo número sem a suíte reclamar.
    //
    // Falhou? Escreva o CNPJ como literal no arquivo de spec -- dentro do
    // INSERT ou como argumento literal do helper, tanto faz, os dois são
    // vistos. O que NÃO pode é montar o CNPJ em tempo de execução
    // (concatenação, contador, random): um valor que só existe durante a
    // rodada é, por construção, invisível a qualquer varredura estática e
    // reabre exatamente este buraco. A única exceção legítima é código de
    // PRODUÇÃO com CNPJ dinâmico de verdade (ver PRODUCAO_CNPJ_DINAMICO
    // acima) -- um spec de teste NUNCA se qualifica para essa lista.
    const cegos = arquivos()
      .filter(({ texto }) => CRIA_TENANT.test(texto))
      .filter(({ texto }) => cnpjsDoArquivo(texto).size === 0)
      .map(({ rel }) => rel)
      .filter((rel) => !PRODUCAO_CNPJ_DINAMICO.has(rel))
      .sort();

    expect(cegos).toEqual([]);
  });
});
