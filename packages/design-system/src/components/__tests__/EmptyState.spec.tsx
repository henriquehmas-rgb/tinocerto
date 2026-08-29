import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Briefcase } from "lucide-react";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("mostra título e descrição", () => {
    render(
      <EmptyState
        icone={Briefcase}
        titulo="Nenhuma vaga ainda"
        descricao="Crie sua primeira vaga para começar a receber candidaturas."
      />,
    );
    expect(screen.getByText("Nenhuma vaga ainda")).toBeInTheDocument();
    expect(
      screen.getByText("Crie sua primeira vaga para começar a receber candidaturas."),
    ).toBeInTheDocument();
  });

  it("renderiza a ação quando informada e omite quando ausente", () => {
    const { unmount } = render(
      <EmptyState
        icone={Briefcase}
        titulo="Nenhuma vaga ainda"
        descricao="Crie sua primeira vaga."
        acao={<button type="button">Criar vaga</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Criar vaga" })).toBeInTheDocument();
    unmount();

    render(<EmptyState icone={Briefcase} titulo="Vazio" descricao="Nada aqui." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
