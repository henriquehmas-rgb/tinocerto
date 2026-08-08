import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from '../Button';

describe('Button', () => {
  it('renderiza o texto filho e aplica a classe do variant primary por padrao', () => {
    render(<Button>Publicar vaga</Button>);
    const button = screen.getByRole('button', { name: 'Publicar vaga' });
    expect(button).toHaveClass('bg-accent');
  });

  it('aplica a classe do variant secondary quando especificado', () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('bg-surface');
  });

  it('chama onClick ao clicar', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
