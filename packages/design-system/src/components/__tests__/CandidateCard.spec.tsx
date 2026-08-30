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

  it("renderiza o nome como link quando href é passado", () => {
    render(<CandidateCard nome="Ana Souza" href="/staff/painel/candidaturas/app-1" />);
    const link = screen.getByRole("link", { name: "Ana Souza" });
    expect(link).toHaveAttribute("href", "/staff/painel/candidaturas/app-1");
  });

  it("não renderiza o nome como link quando href não é passado", () => {
    // O caminho de <span> puro (sem link) precisa continuar funcionando --
    // é o usado por qualquer consumidor do card fora do funil.
    render(<CandidateCard nome="Ana Souza" />);
    expect(screen.queryByRole("link", { name: "Ana Souza" })).toBeNull();
  });

  it("usa o componente de link injetado em linkAs", () => {
    function LinkFalso({ href, children, ...resto }: React.ComponentProps<"a">) {
      return (
        <a href={href} data-link-injetado="sim" {...resto}>
          {children}
        </a>
      );
    }
    render(<CandidateCard nome="Ana Souza" href="/staff/painel/candidaturas/app-1" linkAs={LinkFalso} />);
    expect(screen.getByRole("link", { name: "Ana Souza" })).toHaveAttribute("data-link-injetado", "sim");
  });

  it("o link do nome tem draggable=false para não competir com o drag do card", () => {
    // O card raiz é `draggable`, e um <a href> nativo também é arrastável por
    // padrão -- o navegador prioriza o drag do link (a URL) sobre o do card.
    // Sem draggable={false} aqui, começar o arrasto pelo nome quebraria o
    // drag-and-drop do funil.
    render(<CandidateCard nome="Ana Souza" href="/staff/painel/candidaturas/app-1" />);
    expect(screen.getByRole("link", { name: "Ana Souza" })).toHaveAttribute("draggable", "false");
  });
});
