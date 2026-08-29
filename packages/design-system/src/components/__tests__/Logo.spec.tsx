import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "../Logo";

describe("Logo", () => {
  it("tem nome acessível 'Tinocerto' nas duas variantes", () => {
    const { unmount } = render(<Logo />);
    expect(screen.getByRole("img", { name: "Tinocerto" })).toBeInTheDocument();
    unmount();
    render(<Logo variante="simbolo" />);
    expect(screen.getByRole("img", { name: "Tinocerto" })).toBeInTheDocument();
  });

  it("pinta o wordmark com currentColor, não com uma cor fixa", () => {
    // Regressão: o SVG original usava fill="#14121C", que some sobre o
    // fundo do tema escuro. currentColor herda a cor do contexto.
    const { container } = render(<Logo />);
    const wordmark = container.querySelector("text");
    expect(wordmark).not.toBeNull();
    expect(wordmark).toHaveAttribute("fill", "currentColor");
    expect(container.innerHTML).not.toContain("#14121C");
  });

  it("a variante símbolo não renderiza o wordmark", () => {
    const { container } = render(<Logo variante="simbolo" />);
    expect(container.querySelector("text")).toBeNull();
  });
});
