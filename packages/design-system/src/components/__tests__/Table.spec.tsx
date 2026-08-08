import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from '../Table';

describe('Table', () => {
  it('renderiza cabeçalhos e uma linha por item, usando render() de cada coluna', () => {
    const rows = [{ id: '1', titulo: 'Vaga A' }];
    render(
      <Table
        columns={[
          { header: 'Título', render: (row: (typeof rows)[0]) => row.titulo },
        ]}
        rows={rows}
      />,
    );
    expect(screen.getByText('Título')).toBeInTheDocument();
    expect(screen.getByText('Vaga A')).toBeInTheDocument();
  });

  it('renderiza mensagem de vazio quando rows está vazio', () => {
    render(<Table columns={[{ header: 'Título', render: () => null }]} rows={[]} />);
    expect(screen.getByText('Nenhum item encontrado')).toBeInTheDocument();
  });
});
