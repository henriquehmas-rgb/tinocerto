import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EtapaBarra } from "../EtapaBarra";

describe("EtapaBarra", () => {
  it("renderiza uma linha por item com rótulo, total e conversão", () => {
    render(
      <EtapaBarra
        itens={[
          { etapa: "triagem", rotulo: "Triagem", total: 10, conversao: null },
          { etapa: "entrevista", rotulo: "Entrevista", total: 4, conversao: 40 },
        ]}
      />,
    );

    expect(screen.getByText("Triagem")).toBeInTheDocument();
    expect(screen.getByText("Entrevista")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("4 · 40%")).toBeInTheDocument();
  });

  it("não mostra percentual quando conversao é null ou undefined", () => {
    render(<EtapaBarra itens={[{ etapa: "triagem", rotulo: "Triagem", total: 7, conversao: null }]} />);

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("não quebra com todos os totais zerados (sem dividir por zero)", () => {
    const { container } = render(
      <EtapaBarra
        itens={[
          { etapa: "triagem", rotulo: "Triagem", total: 0, conversao: null },
          { etapa: "entrevista", rotulo: "Entrevista", total: 0, conversao: null },
        ]}
      />,
    );

    const barras = container.querySelectorAll("[data-testid=\"etapa-barra-fill\"]");
    barras.forEach((barra) => {
      expect((barra as HTMLElement).style.width).toBe("0%");
    });
  });

  it("não quebra com lista vazia", () => {
    render(<EtapaBarra itens={[]} />);
  });
});
