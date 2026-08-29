import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Briefcase, LayoutDashboard } from "lucide-react";
import { PanelNav, iniciaisDe } from "../PanelNav";

// `React` é importado por causa de `React.ComponentProps` abaixo: usar o
// namespace global do UMD dentro de um módulo é erro de tipo, e a Task 8
// roda `tsc --noEmit`.

const GRUPOS = [
  {
    rotulo: "Operação",
    itens: [
      { href: "/staff/painel", label: "Dashboard", icone: LayoutDashboard, ativo: true },
      { href: "/staff/painel/vagas", label: "Vagas", icone: Briefcase, contador: 4 },
    ],
  },
];

function renderNav(sobrescreve: Partial<React.ComponentProps<typeof PanelNav>> = {}) {
  return render(
    <PanelNav
      nomeStaff="ana.souza@empresa.example"
      nomeTenant="Empresa Exemplo Ltda"
      grupos={GRUPOS}
      tema="auto"
      onTemaChange={vi.fn()}
      onSair={vi.fn()}
      {...sobrescreve}
    />,
  );
}

describe("iniciaisDe", () => {
  it("usa o trecho antes do @ quando recebe um e-mail", () => {
    expect(iniciaisDe("ana.souza@empresa.example")).toBe("AS");
  });

  it("usa as duas primeiras letras quando há uma só palavra", () => {
    expect(iniciaisDe("ana@empresa.example")).toBe("AN");
  });

  it("usa as iniciais das duas primeiras palavras de um nome", () => {
    expect(iniciaisDe("Ana Souza Lima")).toBe("AS");
  });

  it("devolve string vazia para entrada vazia, nunca undefined", () => {
    expect(iniciaisDe("")).toBe("");
  });
});

describe("PanelNav", () => {
  it("mostra rótulo de grupo, itens, tenant e staff", () => {
    renderNav();
    expect(screen.getByText("Operação")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/staff/painel");
    expect(screen.getByText("Empresa Exemplo Ltda")).toBeInTheDocument();
    expect(screen.getByText("ana.souza@empresa.example")).toBeInTheDocument();
  });

  it("marca o item ativo com aria-current e não marca os demais", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Vagas/ })).not.toHaveAttribute("aria-current");
  });

  it("mostra o contador quando informado e o omite quando ausente", () => {
    const { unmount } = renderNav();
    expect(screen.getByText("4")).toBeInTheDocument();
    unmount();

    renderNav({
      grupos: [
        {
          rotulo: "Operação",
          itens: [{ href: "/staff/painel/vagas", label: "Vagas", icone: Briefcase }],
        },
      ],
    });
    expect(screen.queryByText("4")).toBeNull();
  });

  it("mostra as iniciais do staff no avatar", () => {
    renderNav();
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("chama onSair ao clicar em Sair", () => {
    const onSair = vi.fn();
    renderNav({ onSair });
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(onSair).toHaveBeenCalledTimes(1);
  });

  it("renderiza o seletor de tema ligado às props", () => {
    const onTemaChange = vi.fn();
    renderNav({ tema: "dark", onTemaChange });
    expect(screen.getByRole("radio", { name: "Tema escuro" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Tema claro" }));
    expect(onTemaChange).toHaveBeenCalledWith("light");
  });

  it("usa o componente de link injetado em linkAs", () => {
    function LinkFalso({ href, children, ...resto }: React.ComponentProps<"a">) {
      return (
        <a href={href} data-link-injetado="sim" {...resto}>
          {children}
        </a>
      );
    }
    renderNav({ linkAs: LinkFalso });
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-link-injetado", "sim");
  });
});
