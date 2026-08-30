import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BarraSelecao } from "../BarraSelecao";

describe("BarraSelecao", () => {
  it("mostra a quantidade no plural", () => {
    render(<BarraSelecao quantidade={3} onMoverEtapa={vi.fn()} onLimparSelecao={vi.fn()} />);
    expect(screen.getByText("3 selecionados")).toBeInTheDocument();
  });

  it("mostra a quantidade no singular", () => {
    render(<BarraSelecao quantidade={1} onMoverEtapa={vi.fn()} onLimparSelecao={vi.fn()} />);
    expect(screen.getByText("1 selecionado")).toBeInTheDocument();
  });

  it("mostra a dica de shift+clique", () => {
    render(<BarraSelecao quantidade={2} onMoverEtapa={vi.fn()} onLimparSelecao={vi.fn()} />);
    expect(screen.getByText(/shift\+clique/i)).toBeInTheDocument();
  });

  it("dispara onMoverEtapa ao clicar em mover", () => {
    const onMoverEtapa = vi.fn();
    render(<BarraSelecao quantidade={2} onMoverEtapa={onMoverEtapa} onLimparSelecao={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /mover etapa/i }));
    expect(onMoverEtapa).toHaveBeenCalledTimes(1);
  });

  it("dispara onLimparSelecao ao clicar em limpar", () => {
    const onLimparSelecao = vi.fn();
    render(<BarraSelecao quantidade={2} onMoverEtapa={vi.fn()} onLimparSelecao={onLimparSelecao} />);
    fireEvent.click(screen.getByRole("button", { name: /limpar seleção/i }));
    expect(onLimparSelecao).toHaveBeenCalledTimes(1);
  });
});
