import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
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

  it("mostra 0% quando a conversão é exatamente zero (zero é uma taxa legítima, não 'ausência de dado')", () => {
    // Risco sinalizado: uma guarda escrita como checagem "truthy"
    // (`conversao ? ... : null`) esconderia esse zero por engano. A guarda
    // correta compara explicitamente com null/undefined.
    render(
      <KanbanBoard
        colunas={[{ chave: "triagem", titulo: "Triagem", conversao: 0 }]}
        itens={{ triagem: [] }}
        renderItem={(item: ItemTeste) => <span>{item.nome}</span>}
        onMoverItem={vi.fn()}
      />,
    );
    const triagem = screen.getByTestId("coluna-triagem");
    expect(within(triagem).getByTestId("conversao")).toHaveTextContent("0%");
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
    act(() => {
      screen.getByTestId("coluna-entrevista").dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(true);
  });
});

// O jsdom usado neste projeto não implementa o construtor nativo
// `DragEvent` (window.DragEvent é undefined). O fireEvent.dragLeave do
// testing-library cai então para um `Event` genérico, que ignora
// silenciosamente a opção `relatedTarget` — o campo não existe em Event.
// Por isso construímos o evento manualmente e definimos `relatedTarget`
// via Object.defineProperty antes de despachar, igual ao teste de
// dragover logo acima que já despacha um Event bruto diretamente.
function dispararDragLeave(elemento: Element, relatedTarget: EventTarget | null) {
  const evento = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperty(evento, "relatedTarget", { value: relatedTarget });
  act(() => {
    elemento.dispatchEvent(evento);
  });
}

describe("KanbanBoard - destaque de alvo de drop", () => {
  it("marca a coluna como alvo ao arrastar um item sobre ela, e desmarca ao sair", () => {
    renderBoard({ onSoltarItem: vi.fn() });
    const coluna = screen.getByTestId("coluna-entrevista");

    fireEvent.dragEnter(coluna);
    expect(coluna).toHaveAttribute("data-sobreposto", "true");

    // Sai da coluna de fato: relatedTarget fica fora dela.
    dispararDragLeave(coluna, document.body);
    expect(coluna).not.toHaveAttribute("data-sobreposto");
  });

  it("não pisca o destaque quando o dragleave é disparado ao entrar num card filho", () => {
    // Armadilha clássica: dragleave dispara ao cruzar para um elemento
    // filho (o card), não só ao sair da coluna. O destaque deve persistir.
    renderBoard({ onSoltarItem: vi.fn() });
    const coluna = screen.getByTestId("coluna-entrevista");

    fireEvent.dragEnter(coluna);
    expect(coluna).toHaveAttribute("data-sobreposto", "true");

    const cardFilho = within(coluna).getByText("Bruno");
    dispararDragLeave(coluna, cardFilho);
    expect(coluna).toHaveAttribute("data-sobreposto", "true");
  });

  it("desmarca o alvo ao soltar o item", () => {
    const onSoltarItem = vi.fn();
    renderBoard({ onSoltarItem });
    const coluna = screen.getByTestId("coluna-entrevista");

    fireEvent.dragEnter(coluna);
    expect(coluna).toHaveAttribute("data-sobreposto", "true");

    fireEvent.drop(coluna);
    expect(coluna).not.toHaveAttribute("data-sobreposto");
  });

  it("nunca marca o alvo numa coluna sem onSoltarItem", () => {
    renderBoard();
    const coluna = screen.getByTestId("coluna-entrevista");

    fireEvent.dragEnter(coluna);
    expect(coluna).not.toHaveAttribute("data-sobreposto");

    fireEvent.dragOver(coluna);
    expect(coluna).not.toHaveAttribute("data-sobreposto");
  });
});
