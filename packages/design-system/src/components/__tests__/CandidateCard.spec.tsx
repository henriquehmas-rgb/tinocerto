import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CandidateCard } from "../CandidateCard";

describe("CandidateCard", () => {
  it("mostra o nome e as iniciais no avatar", () => {
    render(<CandidateCard nome="Ana Souza" />);
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("mostra o fit quando há score", () => {
    render(<CandidateCard nome="Ana Souza" scoreAderencia={72} />);
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("não renderiza nada de fit quando o score é null", () => {
    // Regressão que motivou o design: hoje TODO candidato do produto tem
    // score nulo (o parser de currículo depende de uma chave de LLM que não
    // está configurada). Um "0" ou barra vazia em todo card faria o produto
    // parecer quebrado.
    const { container } = render(<CandidateCard nome="Ana Souza" scoreAderencia={null} />);
    expect(container.querySelector('[data-testid="fit"]')).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("não renderiza nada de fit quando o score é omitido", () => {
    const { container } = render(<CandidateCard nome="Ana Souza" />);
    expect(container.querySelector('[data-testid="fit"]')).toBeNull();
  });

  it("renderiza os chips na ordem recebida, sem traduzir nada", () => {
    render(
      <CandidateCard
        nome="Ana Souza"
        chips={[{ rotulo: "Assessment concluído" }, { rotulo: "Site de carreiras" }, { rotulo: "há 3 dias" }]}
      />,
    );
    const chips = screen.getAllByTestId("chip").map((c) => c.textContent);
    expect(chips).toEqual(["Assessment concluído", "Site de carreiras", "há 3 dias"]);
  });

  it("renderiza a ação recebida", () => {
    render(<CandidateCard nome="Ana Souza" acao={<button type="button">Mover</button>} />);
    expect(screen.getByRole("button", { name: "Mover" })).toBeInTheDocument();
  });

  it("dispara onArrastarInicio quando arrastável", () => {
    const onArrastarInicio = vi.fn();
    render(<CandidateCard nome="Ana Souza" arrastavel onArrastarInicio={onArrastarInicio} />);
    const card = screen.getByTestId("candidate-card");
    expect(card).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(card);
    expect(onArrastarInicio).toHaveBeenCalledTimes(1);
  });

  it("não é arrastável por padrão", () => {
    render(<CandidateCard nome="Ana Souza" />);
    expect(screen.getByTestId("candidate-card")).not.toHaveAttribute("draggable", "true");
  });
});
