import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from '../KanbanBoard';

interface ItemTeste {
  id: string;
  nome: string;
}

describe('KanbanBoard', () => {
  const colunas = [
    { chave: 'triagem', titulo: 'Triagem' },
    { chave: 'entrevista', titulo: 'Entrevista' },
  ];

  it('renderiza cada coluna com seus itens e permite mover via menu', async () => {
    const onMoverItem = vi.fn();
    const itens: Record<string, ItemTeste[]> = {
      triagem: [{ id: '1', nome: 'Ana' }],
      entrevista: [],
    };
    render(
      <KanbanBoard
        colunas={colunas}
        itens={itens}
        renderItem={(item: ItemTeste) => item.nome}
        onMoverItem={onMoverItem}
      />,
    );

    expect(screen.getByText('Triagem')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mover ana/i }));
    // Nota: "Entrevista" também é o título da coluna, então o texto puro é
    // ambíguo no DOM (título da coluna + item do menu "mover para"). O menu
    // de destino usa role="menuitem", então escopamos por role+name para
    // desambiguar sem alterar a intenção do teste (clicar na opção "Entrevista"
    // do menu "mover").
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entrevista' }));

    expect(onMoverItem).toHaveBeenCalledWith({ id: '1', nome: 'Ana' }, 'entrevista');
  });

  it('mostra mensagem de estado vazio numa coluna sem itens', () => {
    render(
      <KanbanBoard
        colunas={colunas}
        itens={{ triagem: [], entrevista: [] }}
        renderItem={(item: ItemTeste) => item.nome}
        onMoverItem={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Nenhum item nesta etapa')).toHaveLength(2);
  });
});
