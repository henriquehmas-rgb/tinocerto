import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { KanbanBoard, type KanbanBoardProps } from "../KanbanBoard";

interface ItemTeste {
  id: string;
  nome: string;
}

describe("KanbanBoard", () => {
  const colunas = [
    { chave: "triagem", titulo: "Triagem" },
    { chave: "entrevista", titulo: "Entrevista" },
  ];

  it("renderiza cada coluna com seus itens e permite mover via menu", async () => {
    const onMoverItem = vi.fn();
    const itens: Record<string, ItemTeste[]> = {
      triagem: [{ id: "1", nome: "Ana" }],
      entrevista: [],
    };
    render(
      <KanbanBoard
        colunas={colunas}
        itens={itens}
        renderItem={(item: ItemTeste, acao: React.ReactNode) => (
          <div className="flex items-center gap-2">
            <span>{item.nome}</span>
            {acao}
          </div>
        )}
        onMoverItem={onMoverItem}
      />,
    );

    expect(screen.getByText("Triagem")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /mover ana/i }));
    // Nota: "Entrevista" também é o título da coluna, então o texto puro é
    // ambíguo no DOM (título da coluna + item do menu "mover para"). O menu
    // de destino usa role="menuitem", então escopamos por role+name para
    // desambiguar sem alterar a intenção do teste (clicar na opção "Entrevista"
    // do menu "mover").
    fireEvent.click(await screen.findByRole("menuitem", { name: "Entrevista" }));

    expect(onMoverItem).toHaveBeenCalledWith({ id: "1", nome: "Ana" }, "entrevista");
  });

  it("mostra mensagem de estado vazio numa coluna sem itens", () => {
    render(
      <KanbanBoard
        colunas={colunas}
        itens={{ triagem: [], entrevista: [] }}
        renderItem={(item: ItemTeste, acao: React.ReactNode) => (
          <>
            {item.nome}
            {acao}
          </>
        )}
        onMoverItem={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Nenhum item nesta etapa")).toHaveLength(2);
  });
});

const ITENS: Record<string, ItemTeste[]> = {
  triagem: [{ id: "a1", nome: "Ana" }],
  entrevista: [{ id: "b1", nome: "Bruno" }],
};

const COLUNAS = [
  { chave: "triagem", titulo: "Triagem" },
  { chave: "entrevista", titulo: "Entrevista", conversao: 50 },
];

// Nota: usamos KanbanBoardProps<ItemTeste> em vez de
// React.ComponentProps<typeof KanbanBoard> porque KanbanBoard é genérico —
// ComponentProps não resolve o parâmetro de tipo T, o que deixa o tsc sem
// conseguir casar o renderItem tipado abaixo.
function renderBoard(sobrescreve: Partial<KanbanBoardProps<ItemTeste>> = {}) {
  return render(
    <KanbanBoard
      colunas={COLUNAS}
      itens={ITENS}
      renderItem={(item: ItemTeste) => <span>{item.nome}</span>}
      onMoverItem={vi.fn()}
      {...sobrescreve}
    />,
  );
}

describe("KanbanBoard - cabeçalho e drop", () => {
  it("mostra o contador de cada coluna", () => {
    renderBoard();
    const triagem = screen.getByTestId("coluna-triagem");
    expect(within(triagem).getByTestId("contador")).toHaveTextContent("1");
  });

  it("mostra a conversão quando existe e omite quando não", () => {
    renderBoard();
    const entrevista = screen.getByTestId("coluna-entrevista");
    expect(within(entrevista).getByTestId("conversao")).toHaveTextContent("50%");

    const triagem = screen.getByTestId("coluna-triagem");
    expect(within(triagem).queryByTestId("conversao")).toBeNull();
  });

  it("avisa a chave da coluna ao soltar um item nela", () => {
    const onSoltarItem = vi.fn();
    renderBoard({ onSoltarItem });
    fireEvent.drop(screen.getByTestId("coluna-entrevista"));
    expect(onSoltarItem).toHaveBeenCalledWith("entrevista");
  });

  it("permite o drop cancelando o dragover", () => {
    // Sem preventDefault no dragover o navegador nunca dispara o drop --
    // é o erro clássico de drag-and-drop nativo.
    renderBoard({ onSoltarItem: vi.fn() });
    const evento = new Event("dragover", { bubbles: true, cancelable: true });
    screen.getByTestId("coluna-entrevista").dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });
});
