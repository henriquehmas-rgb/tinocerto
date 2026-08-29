import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "../ThemeToggle";

describe("ThemeToggle", () => {
  it("marca como selecionada apenas a opção correspondente ao valor", () => {
    render(<ThemeToggle valor="dark" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Tema escuro" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Tema claro" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Tema automático" })).toHaveAttribute("aria-checked", "false");
  });

  it("chama onChange com o valor da opção clicada", () => {
    const onChange = vi.fn();
    render(<ThemeToggle valor="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Tema claro" }));
    expect(onChange).toHaveBeenCalledWith("light");
  });

  it("expõe as três opções como um radiogroup rotulado", () => {
    render(<ThemeToggle valor="auto" onChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
