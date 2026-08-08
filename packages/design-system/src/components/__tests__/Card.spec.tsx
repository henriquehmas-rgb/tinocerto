import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../Card';

describe('Card', () => {
  it('renderiza os filhos dentro de um contêiner com borda', () => {
    render(<Card>Conteúdo do card</Card>);
    expect(screen.getByText('Conteúdo do card')).toBeInTheDocument();
  });
});
