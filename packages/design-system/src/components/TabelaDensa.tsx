import React, { useRef } from "react";

export interface ColunaTabela<T> {
  chave: string;
  titulo: string;
  largura: string;
  alinhamento?: "esquerda" | "direita";
  ordenavel?: boolean;
  render: (item: T) => React.ReactNode;
}

export interface TabelaDensaProps<T extends { id: string }> {
  colunas: ColunaTabela<T>[];
  linhas: T[];
  selecionados: Set<string>;
  onSelecaoChange: (proximo: Set<string>) => void;
  ordenacao: { coluna: string; direcao: "asc" | "desc" } | null;
  onOrdenacaoChange: (coluna: string) => void;
  // Rótulo por item pro aria-label do checkbox da linha -- sem isto, cada
  // linha caía no fallback de `linha.id` (o UUID cru), que um leitor de
  // tela lê como ~36 caracteres de hex por linha. Opcional pra não quebrar
  // consumidores/testes existentes que não passam essa prop.
  rotuloLinha?: (item: T) => string;
}

function CheckboxCabecalho({
  todosSelecionados,
  algunsSelecionados,
  onChange,
}: {
  todosSelecionados: boolean;
  algunsSelecionados: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = algunsSelecionados && !todosSelecionados;
  }, [algunsSelecionados, todosSelecionados]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Selecionar todos"
      checked={todosSelecionados}
      onChange={onChange}
      style={{ accentColor: "var(--pr-accent)" }}
    />
  );
}

export function TabelaDensa<T extends { id: string }>({
  colunas,
  linhas,
  selecionados,
  onSelecaoChange,
  ordenacao,
  onOrdenacaoChange,
  rotuloLinha,
}: TabelaDensaProps<T>) {
  // Âncora do shift+clique: id da última linha clicada individualmente,
  // não a ordem de seleção -- shift+clique seleciona o intervalo VISUAL
  // entre a última linha tocada e a atual, como em qualquer lista nativa.
  const ultimoClicadoRef = useRef<string | null>(null);

  const todosSelecionados = linhas.length > 0 && linhas.every((l) => selecionados.has(l.id));
  const algunsSelecionados = linhas.some((l) => selecionados.has(l.id));

  function alternarTodos() {
    if (todosSelecionados) {
      onSelecaoChange(new Set());
    } else {
      onSelecaoChange(new Set(linhas.map((l) => l.id)));
    }
  }

  function alternarLinha(id: string, comShift: boolean) {
    const proximo = new Set(selecionados);

    if (comShift && ultimoClicadoRef.current !== null) {
      const indices = linhas.map((l) => l.id);
      const indiceAncora = indices.indexOf(ultimoClicadoRef.current);
      const indiceAtual = indices.indexOf(id);
      if (indiceAncora !== -1 && indiceAtual !== -1) {
        const [inicio, fim] = indiceAncora < indiceAtual ? [indiceAncora, indiceAtual] : [indiceAtual, indiceAncora];
        for (let i = inicio; i <= fim; i++) proximo.add(indices[i]);
        onSelecaoChange(proximo);
        ultimoClicadoRef.current = id;
        return;
      }
    }

    if (proximo.has(id)) {
      proximo.delete(id);
    } else {
      proximo.add(id);
    }
    onSelecaoChange(proximo);
    ultimoClicadoRef.current = id;
  }

  function aoTecladoOrdenar(evento: React.KeyboardEvent<HTMLTableCellElement>, chave: string) {
    if (evento.key === "Enter" || evento.key === " ") {
      if (evento.key === " ") evento.preventDefault();
      onOrdenacaoChange(chave);
    }
  }

  const gridTemplate = `32px ${colunas.map((c) => c.largura).join(" ")}`;

  return (
    <table role="table" className="w-full border-collapse font-ui text-sm">
      <thead role="rowgroup">
        <tr
          role="row"
          className="grid items-center border-b border-border"
          style={{
            gridTemplateColumns: gridTemplate,
            gap: "12px",
            height: "34px",
            // Cabeçalho fixo ao rolar -- numa página cheia (25 linhas), sem
            // isto o recrutador perdia de vista os títulos das colunas (e o
            // indicador de ordenação) assim que rolava além das primeiras
            // linhas. `background` sólido é indispensável aqui: sem ele o
            // conteúdo rolando por baixo aparece por trás do texto do
            // cabeçalho, o que fica pior do que não ter o sticky.
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: "var(--pr-surface)",
          }}
        >
          <th role="columnheader" className="px-3">
            <CheckboxCabecalho
              todosSelecionados={todosSelecionados}
              algunsSelecionados={algunsSelecionados}
              onChange={alternarTodos}
            />
          </th>
          {colunas.map((coluna) => {
            const ativa = ordenacao?.coluna === coluna.chave;
            const ariaSort = coluna.ordenavel
              ? ativa
                ? ordenacao?.direcao === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
              : undefined;
            return (
              <th
                key={coluna.chave}
                role="columnheader"
                tabIndex={coluna.ordenavel ? 0 : undefined}
                aria-sort={ariaSort}
                className={`font-ui text-xs font-medium text-text-secondary ${
                  coluna.alinhamento === "direita" ? "text-right" : "text-left"
                }`}
                onClick={coluna.ordenavel ? () => onOrdenacaoChange(coluna.chave) : undefined}
                onKeyDown={coluna.ordenavel ? (evento) => aoTecladoOrdenar(evento, coluna.chave) : undefined}
                style={{ cursor: coluna.ordenavel ? "pointer" : undefined }}
              >
                {coluna.titulo}
                {ativa && <span aria-hidden="true"> {ordenacao?.direcao === "asc" ? "↑" : "↓"}</span>}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {linhas.map((linha) => {
          const selecionada = selecionados.has(linha.id);
          return (
            <tr
              key={linha.id}
              role="row"
              data-selecionada={selecionada || undefined}
              className="grid items-center border-b border-border"
              style={{
                gridTemplateColumns: gridTemplate,
                gap: "12px",
                height: "38px",
                background: selecionada ? "var(--pr-selected)" : undefined,
              }}
            >
              <td role="cell" className="px-3">
                <input
                  type="checkbox"
                  aria-label={`Selecionar linha ${rotuloLinha ? rotuloLinha(linha) : linha.id}`}
                  checked={selecionada}
                  onChange={(evento) => alternarLinha(linha.id, (evento.nativeEvent as MouseEvent).shiftKey)}
                  style={{ accentColor: "var(--pr-accent)" }}
                />
              </td>
              {colunas.map((coluna) => (
                <td
                  key={coluna.chave}
                  role="cell"
                  className={`font-ui text-[13px] text-text ${coluna.alinhamento === "direita" ? "text-right font-num tabular-nums" : "text-left"}`}
                >
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
