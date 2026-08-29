import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Briefcase, LayoutDashboard } from "lucide-react";
import { PanelLayout } from "../PanelLayout";

// `React` é importado por causa de `React.ComponentProps` abaixo — ver a
// mesma nota em PanelNav.spec.tsx.

const GRUPOS = [
  {
    rotulo: "Operação",
    itens: [
      { href: "/staff/painel", label: "Dashboard", icone: LayoutDashboard, ativo: true },
      { href: "/staff/painel/vagas", label: "Vagas", icone: Briefcase },
    ],
  },
];

function renderLayout(sobrescreve: Partial<React.ComponentProps<typeof PanelLayout>> = {}) {
  const props: React.ComponentProps<typeof PanelLayout> = {
    nomeStaff: "Ana Recrutadora",
    nomeTenant: "Empresa X",
    grupos: GRUPOS,
    breadcrumb: [{ label: "Dashboard" }],
    tema: "auto",
    onTemaChange: vi.fn(),
    onSair: vi.fn(),
    children: <p>Conteúdo da página</p>,
    ...sobrescreve,
  };
  return render(<PanelLayout {...props} />);
}

describe("PanelLayout", () => {
  it("mostra tenant, staff, filhos e os links de navegação", () => {
    renderLayout();
    expect(screen.getByText("Empresa X")).toBeInTheDocument();
    expect(screen.getByText("Ana Recrutadora")).toBeInTheDocument();
    expect(screen.getByText("Conteúdo da página")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/staff/painel");
    expect(screen.getByRole("link", { name: "Vagas" })).toHaveAttribute("href", "/staff/painel/vagas");
  });

  it("chama onSair ao clicar em Sair", () => {
    const onSair = vi.fn();
    renderLayout({ onSair });
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(onSair).toHaveBeenCalledTimes(1);
  });

  it("renderiza a trilha, com o item atual como texto e os anteriores como link", () => {
    renderLayout({
      breadcrumb: [{ label: "Vagas", href: "/staff/painel/vagas" }, { label: "Engenheiro de Dados" }],
    });
    const trilha = screen.getByRole("navigation", { name: "Trilha" });
    expect(trilha).toBeInTheDocument();
    // O item anterior é link; o atual, não.
    // Consultas escopadas a `trilha`: a sidebar (GRUPOS) também tem um item
    // "Vagas" com o mesmo href, então uma consulta global por role "link" e
    // nome "Vagas" seria ambígua.
    expect(within(trilha).getByRole("link", { name: "Vagas" })).toHaveAttribute("href", "/staff/painel/vagas");
    expect(within(trilha).queryByRole("link", { name: "Engenheiro de Dados" })).toBeNull();
    expect(within(trilha).getByText("Engenheiro de Dados")).toHaveAttribute("aria-current", "page");
  });

  it("renderiza o slot de ação e o omite quando ausente", () => {
    const { unmount } = renderLayout({ acao: <button type="button">Nova vaga</button> });
    expect(screen.getByRole("button", { name: "Nova vaga" })).toBeInTheDocument();
    unmount();

    renderLayout();
    expect(screen.queryByRole("button", { name: "Nova vaga" })).toBeNull();
  });

  it("coloca o conteúdo da página dentro de main, separado da navegação", () => {
    // A Task 9 depende disto: os testes de página consultam dentro de <main>
    // para não colidir com números iguais exibidos na sidebar.
    renderLayout();
    expect(screen.getByRole("main")).toHaveTextContent("Conteúdo da página");
    expect(screen.getByRole("main")).not.toHaveTextContent("Empresa X");
  });
});
