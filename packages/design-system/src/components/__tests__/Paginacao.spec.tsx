import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Paginacao } from "../Paginacao";

describe("Paginacao", () => {
  it("mostra o intervalo correto no meio da lista", () => {
    render(
      <Paginacao paginaAtual={2} totalPaginas={3} totalItens={25} itensPorPagina={10} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByText("11–20 de 25")).toBeInTheDocument();
  });

  it("mostra o intervalo correto na ultima pagina parcial", () => {
    render(
      <Paginacao paginaAtual={3} totalPaginas={3} totalItens={25} itensPorPagina={10} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByText("21–25 de 25")).toBeInTheDocument();
  });

  it("mostra o intervalo correto na primeira pagina", () => {
    render(
      <Paginacao paginaAtual={1} totalPaginas={17} totalItens={207} itensPorPagina={12} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByText("1–12 de 207")).toBeInTheDocument();
  });

  it("desabilita anterior na primeira pagina", () => {
    render(
      <Paginacao paginaAtual={1} totalPaginas={3} totalItens={25} itensPorPagina={10} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();
  });

  it("desabilita proxima na ultima pagina", () => {
    render(
      <Paginacao paginaAtual={3} totalPaginas={3} totalItens={25} itensPorPagina={10} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /próxima/i })).toBeDisabled();
  });

  it("avanca e retrocede pagina", () => {
    const onPaginaChange = vi.fn();
    render(
      <Paginacao paginaAtual={2} totalPaginas={3} totalItens={25} itensPorPagina={10} onPaginaChange={onPaginaChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /próxima/i }));
    expect(onPaginaChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
    expect(onPaginaChange).toHaveBeenCalledWith(1);
  });

  it("com lista vazia mostra 0–0 de 0 e os dois botoes desabilitados", () => {
    render(
      <Paginacao paginaAtual={1} totalPaginas={1} totalItens={0} itensPorPagina={25} onPaginaChange={vi.fn()} />,
    );
    expect(screen.getByText("0–0 de 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /próxima/i })).toBeDisabled();
  });
});
