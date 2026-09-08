import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from '../Field';

describe('Field', () => {
  it('associa o rótulo ao filho via htmlFor/id e renderiza a dica', () => {
    render(
      <Field label="Título" htmlFor="titulo-vaga" hint="Visível para candidatos">
        <input id="titulo-vaga" />
      </Field>,
    );

    expect(screen.getByLabelText('Título')).toBeInTheDocument();
    expect(screen.getByText('Visível para candidatos')).toBeInTheDocument();
  });

  it('renderiza a mensagem de erro quando presente', () => {
    render(
      <Field label="Título" htmlFor="titulo-vaga" erro="Campo obrigatório">
        <input id="titulo-vaga" />
      </Field>,
    );

    expect(screen.getByText('Campo obrigatório')).toBeInTheDocument();
  });

  it('não renderiza dica nem erro quando ausentes', () => {
    const { container } = render(
      <Field label="Título" htmlFor="titulo-vaga">
        <input id="titulo-vaga" />
      </Field>,
    );

    expect(container.querySelectorAll('p').length).toBe(0);
  });
});
