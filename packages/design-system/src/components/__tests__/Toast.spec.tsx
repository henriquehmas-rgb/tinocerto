import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toast } from "../Toast";

describe("Toast", () => {
  it("mostra a mensagem com role=status", () => {
    render(<Toast mensagem="28 movidos" aoFechar={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("28 movidos");
  });

  it("fecha sozinho apos a duracao", () => {
    vi.useFakeTimers();
    const aoFechar = vi.fn();
    render(<Toast mensagem="28 movidos" aoFechar={aoFechar} duracaoMs={1000} />);
    expect(aoFechar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("renderiza a acao quando informada e a executa ao clicar", () => {
    const onClick = vi.fn();
    render(<Toast mensagem="28 movidos" acao={{ rotulo: "Desfazer", onClick }} aoFechar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("sem acao nao renderiza nenhum botao", () => {
    render(<Toast mensagem="28 movidos" aoFechar={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("usa 6000ms como duracao padrao quando nao informada", () => {
    vi.useFakeTimers();
    const aoFechar = vi.fn();
    render(<Toast mensagem="28 movidos" aoFechar={aoFechar} />);
    vi.advanceTimersByTime(5999);
    expect(aoFechar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
