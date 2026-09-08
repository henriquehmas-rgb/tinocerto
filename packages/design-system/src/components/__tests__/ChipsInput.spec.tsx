import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipsInput } from '../ChipsInput';

describe('ChipsInput', () => {
  it('renderiza um chip por valor, cada um com botão de remover', () => {
    render(<ChipsInput valores={['SQL', 'Python']} onChange={() => {}} />);

    expect(screen.getByText('SQL')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover SQL' })).toBeInTheDocument();
  });

  it('repassa id ao campo de texto interno -- é o que permite um <label htmlFor> externo associar', () => {
    render(<ChipsInput id="habilidades-vaga" valores={[]} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'habilidades-vaga');
  });

  it('adiciona um chip novo ao pressionar Enter no campo de texto', async () => {
    const onChange = vi.fn();
    render(<ChipsInput valores={['SQL']} onChange={onChange} />);

    const campo = screen.getByRole('textbox');
    await userEvent.type(campo, 'Python{Enter}');

    expect(onChange).toHaveBeenCalledWith(['SQL', 'Python']);
  });

  it('adiciona um chip novo ao digitar vírgula', async () => {
    const onChange = vi.fn();
    render(<ChipsInput valores={[]} onChange={onChange} />);

    const campo = screen.getByRole('textbox');
    await userEvent.type(campo, 'SQL,');

    expect(onChange).toHaveBeenCalledWith(['SQL']);
  });

  it('não adiciona chip vazio nem duplicado', async () => {
    const onChange = vi.fn();
    render(<ChipsInput valores={['SQL']} onChange={onChange} />);

    const campo = screen.getByRole('textbox');
    await userEvent.type(campo, '{Enter}');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(campo, 'SQL{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('remove um chip ao clicar no seu botão de remover', async () => {
    const onChange = vi.fn();
    render(<ChipsInput valores={['SQL', 'Python']} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remover SQL' }));

    expect(onChange).toHaveBeenCalledWith(['Python']);
  });

  it('Backspace num campo vazio remove o último chip', async () => {
    const onChange = vi.fn();
    render(<ChipsInput valores={['SQL', 'Python']} onChange={onChange} />);

    const campo = screen.getByRole('textbox');
    await userEvent.click(campo);
    await userEvent.keyboard('{Backspace}');

    expect(onChange).toHaveBeenCalledWith(['SQL']);
  });
});
