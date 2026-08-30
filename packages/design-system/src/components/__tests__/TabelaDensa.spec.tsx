import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { TabelaDensa, type ColunaTabela } from "../TabelaDensa";

interface ItemTeste {
  id: string;
  nome: string;
  numero: number;
}

const ITENS: ItemTeste[] = [
  { id: "a", nome: "Ana", numero: 10 },
  { id: "b", nome: "Bruno", numero: 20 },
  { id: "c", nome: "Carla", numero: 30 },
];

const COLUNAS: ColunaTabela<ItemTeste>[] = [
  { chave: "nome", titulo: "Nome", largura: "1fr", ordenavel: true, render: (i) => i.nome },
  { chave: "numero", titulo: "Número", largura: "80px", alinhamento: "direita", ordenavel: true, render: (i) => String(i.numero) },
];

function renderTabela(sobrescreve: Partial<React.ComponentProps<typeof TabelaDensa<ItemTeste>>> = {}) {
  const props: React.ComponentProps<typeof TabelaDensa<ItemTeste>> = {
    colunas: COLUNAS,
    linhas: ITENS,
    selecionados: new Set(),
    onSelecaoChange: vi.fn(),
    ordenacao: null,
    onOrdenacaoChange: vi.fn(),
    ...sobrescreve,
  };
  return render(<TabelaDensa {...props} />);
}

describe("TabelaDensa", () => {
  it("renderiza o titulo de cada coluna e o conteudo de cada linha", () => {
    renderTabela();
    expect(screen.getByText("Nome")).toBeInTheDocument();
    expect(screen.getByText("Número")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("clicar no titulo de uma coluna ordenavel dispara onOrdenacaoChange com a chave", () => {
    const onOrdenacaoChange = vi.fn();
    renderTabela({ onOrdenacaoChange });
    fireEvent.click(screen.getByText("Nome"));
    expect(onOrdenacaoChange).toHaveBeenCalledWith("nome");
  });

  it("cabecalho de coluna ordenavel mantem role columnheader (nao button) para preservar a semantica de coluna para leitores de tela", () => {
    renderTabela();
    const cabecalhoNome = screen.getByText("Nome").closest("th")!;
    expect(cabecalhoNome).toHaveAttribute("role", "columnheader");
    expect(screen.getByRole("columnheader", { name: "Nome" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nome" })).not.toBeInTheDocument();
  });

  it("aria-sort reflete a coluna e a direcao ativas: ascending, descending e none", () => {
    const { rerender } = renderTabela({ ordenacao: { coluna: "nome", direcao: "asc" } });
    expect(screen.getByText("Nome").closest("th")).toHaveAttribute("aria-sort", "ascending");
    // Coluna ordenavel mas nao ativa (Número) fica "none", nao ausente.
    expect(screen.getByText("Número").closest("th")).toHaveAttribute("aria-sort", "none");

    rerender(
      <TabelaDensa
        colunas={COLUNAS}
        linhas={ITENS}
        selecionados={new Set()}
        onSelecaoChange={vi.fn()}
        ordenacao={{ coluna: "nome", direcao: "desc" }}
        onOrdenacaoChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Nome").closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("cabecalho de coluna nao-ordenavel nao tem atributo aria-sort", () => {
    const colunasSemOrdenacao: ColunaTabela<ItemTeste>[] = [
      { chave: "nome", titulo: "Nome", largura: "1fr", render: (i) => i.nome },
    ];
    renderTabela({ colunas: colunasSemOrdenacao });
    expect(screen.getByText("Nome").closest("th")).not.toHaveAttribute("aria-sort");
  });

  it("pressionar Enter no cabecalho ordenavel focado dispara onOrdenacaoChange com a chave da coluna", () => {
    const onOrdenacaoChange = vi.fn();
    renderTabela({ onOrdenacaoChange });
    const cabecalhoNome = screen.getByText("Nome").closest("th")!;
    fireEvent.keyDown(cabecalhoNome, { key: "Enter" });
    expect(onOrdenacaoChange).toHaveBeenCalledWith("nome");
  });

  it("pressionar Espaco no cabecalho ordenavel dispara onOrdenacaoChange e previne o scroll padrao da pagina", () => {
    const onOrdenacaoChange = vi.fn();
    renderTabela({ onOrdenacaoChange });
    const cabecalhoNome = screen.getByText("Nome").closest("th")!;
    const evento = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => {
      cabecalhoNome.dispatchEvent(evento);
    });
    expect(onOrdenacaoChange).toHaveBeenCalledWith("nome");
    expect(evento.defaultPrevented).toBe(true);
  });

  it("checkbox do cabecalho fica desmarcado quando nada esta selecionado", () => {
    renderTabela({ selecionados: new Set() });
    const checkboxCabecalho = screen.getByRole("checkbox", { name: /selecionar todos/i });
    expect(checkboxCabecalho).not.toBeChecked();
    expect((checkboxCabecalho as HTMLInputElement).indeterminate).toBe(false);
  });

  it("checkbox do cabecalho fica marcado quando tudo esta selecionado", () => {
    renderTabela({ selecionados: new Set(["a", "b", "c"]) });
    const checkboxCabecalho = screen.getByRole("checkbox", { name: /selecionar todos/i });
    expect(checkboxCabecalho).toBeChecked();
  });

  it("checkbox do cabecalho fica indeterminate quando parte esta selecionada", () => {
    renderTabela({ selecionados: new Set(["a"]) });
    const checkboxCabecalho = screen.getByRole("checkbox", { name: /selecionar todos/i });
    expect((checkboxCabecalho as HTMLInputElement).indeterminate).toBe(true);
  });

  it("marcar o checkbox do cabecalho seleciona todas as linhas visiveis", () => {
    const onSelecaoChange = vi.fn();
    renderTabela({ selecionados: new Set(), onSelecaoChange });
    fireEvent.click(screen.getByRole("checkbox", { name: /selecionar todos/i }));
    expect(onSelecaoChange).toHaveBeenCalledWith(new Set(["a", "b", "c"]));
  });

  it("desmarcar o checkbox do cabecalho quando tudo selecionado limpa a selecao", () => {
    const onSelecaoChange = vi.fn();
    renderTabela({ selecionados: new Set(["a", "b", "c"]), onSelecaoChange });
    fireEvent.click(screen.getByRole("checkbox", { name: /selecionar todos/i }));
    expect(onSelecaoChange).toHaveBeenCalledWith(new Set());
  });

  it("clicar no checkbox de uma linha adiciona ela a selecao", () => {
    const onSelecaoChange = vi.fn();
    renderTabela({ selecionados: new Set(["a"]), onSelecaoChange });
    const linhaBruno = screen.getByText("Bruno").closest("tr")!;
    fireEvent.click(within(linhaBruno).getByRole("checkbox"));
    expect(onSelecaoChange).toHaveBeenCalledWith(new Set(["a", "b"]));
  });

  it("shift+clique seleciona o intervalo desde o ultimo clicado", () => {
    const onSelecaoChange = vi.fn();
    const { rerender } = renderTabela({ selecionados: new Set(), onSelecaoChange });
    const linhaAna = screen.getByText("Ana").closest("tr")!;
    fireEvent.click(within(linhaAna).getByRole("checkbox"));
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a"]));

    rerender(
      <TabelaDensa
        colunas={COLUNAS}
        linhas={ITENS}
        selecionados={new Set(["a"])}
        onSelecaoChange={onSelecaoChange}
        ordenacao={null}
        onOrdenacaoChange={vi.fn()}
      />,
    );
    const linhaCarla = screen.getByText("Carla").closest("tr")!;
    fireEvent.click(within(linhaCarla).getByRole("checkbox"), { shiftKey: true });
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a", "b", "c"]));
  });

  it("clicar individualmente depois de um shift+clique reancora o proximo shift+clique na nova linha", () => {
    const onSelecaoChange = vi.fn();
    const { rerender } = renderTabela({ selecionados: new Set(), onSelecaoChange });

    // 1. clique individual em Ana -> ancora fica em "a"
    const linhaAna = screen.getByText("Ana").closest("tr")!;
    fireEvent.click(within(linhaAna).getByRole("checkbox"));
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a"]));

    rerender(
      <TabelaDensa
        colunas={COLUNAS}
        linhas={ITENS}
        selecionados={new Set(["a"])}
        onSelecaoChange={onSelecaoChange}
        ordenacao={null}
        onOrdenacaoChange={vi.fn()}
      />,
    );

    // 2. shift+clique em Carla seleciona o intervalo Ana..Carla
    const linhaCarla = screen.getByText("Carla").closest("tr")!;
    fireEvent.click(within(linhaCarla).getByRole("checkbox"), { shiftKey: true });
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a", "b", "c"]));

    rerender(
      <TabelaDensa
        colunas={COLUNAS}
        linhas={ITENS}
        selecionados={new Set(["a", "b", "c"])}
        onSelecaoChange={onSelecaoChange}
        ordenacao={null}
        onOrdenacaoChange={vi.fn()}
      />,
    );

    // 3. clique individual (sem shift) em Bruno alterna ele para fora da selecao
    // e move a ancora do shift+clique para "b"
    const linhaBruno = screen.getByText("Bruno").closest("tr")!;
    fireEvent.click(within(linhaBruno).getByRole("checkbox"));
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a", "c"]));

    rerender(
      <TabelaDensa
        colunas={COLUNAS}
        linhas={ITENS}
        selecionados={new Set(["a", "c"])}
        onSelecaoChange={onSelecaoChange}
        ordenacao={null}
        onOrdenacaoChange={vi.fn()}
      />,
    );

    // 4. shift+clique em Carla de novo: se a ancora realmente moveu para "b" no
    // passo 3, o intervalo agora e Bruno..Carla, trazendo "b" de volta para a
    // selecao. Se a ancora tivesse ficado em "c" (regressao), o intervalo
    // seria so [c, c] e "b" nao voltaria.
    fireEvent.click(within(screen.getByText("Carla").closest("tr")!).getByRole("checkbox"), { shiftKey: true });
    expect(onSelecaoChange).toHaveBeenLastCalledWith(new Set(["a", "b", "c"]));
  });

  it("linha selecionada tem o estilo de selecao", () => {
    renderTabela({ selecionados: new Set(["b"]) });
    const linhaBruno = screen.getByText("Bruno").closest("tr")!;
    expect(linhaBruno).toHaveAttribute("data-selecionada", "true");
    expect(linhaBruno).toHaveStyle({ background: "var(--pr-selected)" });
  });

  it("clicar no nome de uma coluna nao-ordenavel nao dispara onOrdenacaoChange", () => {
    const onOrdenacaoChange = vi.fn();
    const colunasSemOrdenacao: ColunaTabela<ItemTeste>[] = [
      { chave: "nome", titulo: "Nome", largura: "1fr", render: (i) => i.nome },
    ];
    renderTabela({ colunas: colunasSemOrdenacao, onOrdenacaoChange });
    fireEvent.click(screen.getByText("Nome"));
    expect(onOrdenacaoChange).not.toHaveBeenCalled();
  });

  it("usa rotuloLinha para montar o aria-label do checkbox da linha quando fornecido", () => {
    renderTabela({ rotuloLinha: (item) => item.nome });
    const linhaBruno = screen.getByText("Bruno").closest("tr")!;
    expect(within(linhaBruno).getByRole("checkbox", { name: "Selecionar linha Bruno" })).toBeInTheDocument();
  });

  it("sem rotuloLinha, o aria-label do checkbox da linha cai no id (comportamento atual preservado)", () => {
    renderTabela();
    const linhaBruno = screen.getByText("Bruno").closest("tr")!;
    expect(within(linhaBruno).getByRole("checkbox", { name: "Selecionar linha b" })).toBeInTheDocument();
  });
});
