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

  it("ArrowRight na opção focada chama onChange com a próxima opção", () => {
    const onChange = vi.fn();
    render(<ThemeToggle valor="light" onChange={onChange} />);
    const opcaoClara = screen.getByRole("radio", { name: "Tema claro" });
    fireEvent.keyDown(opcaoClara, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("ArrowLeft na primeira opção volta para a última opção (wrap-around)", () => {
    const onChange = vi.fn();
    render(<ThemeToggle valor="light" onChange={onChange} />);
    const opcaoClara = screen.getByRole("radio", { name: "Tema claro" });
    fireEvent.keyDown(opcaoClara, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("auto");
  });

  it("mantém apenas a opção selecionada na ordem de tabulação (roving tabindex)", () => {
    render(<ThemeToggle valor="dark" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Tema claro" })).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("radio", { name: "Tema escuro" })).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("radio", { name: "Tema automático" })).toHaveAttribute("tabIndex", "-1");
  });

  it("move o foco do DOM para a nova opção selecionada ao pressionar uma seta", () => {
    const onChange = vi.fn();
    render(<ThemeToggle valor="light" onChange={onChange} />);
    const opcaoClara = screen.getByRole("radio", { name: "Tema claro" });
    const opcaoEscura = screen.getByRole("radio", { name: "Tema escuro" });
    fireEvent.keyDown(opcaoClara, { key: "ArrowRight" });
    expect(document.activeElement).toBe(opcaoEscura);
  });
});
