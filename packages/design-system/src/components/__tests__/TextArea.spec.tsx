import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextArea } from '../TextArea';

describe('TextArea', () => {
  it('renderiza uma textarea que aceita value/onChange', () => {
    render(<TextArea aria-label="Descrição" value="texto" onChange={() => {}} />);
    expect(screen.getByLabelText('Descrição')).toHaveValue('texto');
  });

  it('usa bg-surface e text-text -- regressão do bug de tema escuro que motivou esta fase', () => {
    render(<TextArea aria-label="Descrição" value="" onChange={() => {}} />);
    const textarea = screen.getByLabelText('Descrição');
    expect(textarea.className).toContain('bg-surface');
    expect(textarea.className).toContain('text-text');
    expect(textarea.className).toContain('border-border-strong');
  });

  it('repassa rows', () => {
    render(<TextArea aria-label="Descrição" rows={6} value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Descrição')).toHaveAttribute('rows', '6');
  });
});
