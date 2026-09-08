import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

describe('Input', () => {
  it('renderiza um input de texto que aceita value/onChange', () => {
    render(<Input aria-label="Título" value="Engenheiro" onChange={() => {}} />);
    expect(screen.getByLabelText('Título')).toHaveValue('Engenheiro');
  });

  it('usa bg-surface e text-text -- regressão do bug de tema escuro que motivou esta fase', () => {
    render(<Input aria-label="Título" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Título');
    expect(input.className).toContain('bg-surface');
    expect(input.className).toContain('text-text');
    expect(input.className).toContain('border-border-strong');
  });

  it('repassa outras props HTML (disabled, placeholder, type)', () => {
    render(<Input aria-label="Campo" disabled placeholder="digite aqui" type="email" onChange={() => {}} value="" />);
    const input = screen.getByLabelText('Campo');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'digite aqui');
    expect(input).toHaveAttribute('type', 'email');
  });
});
