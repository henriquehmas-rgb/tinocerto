import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('aplica a classe de tom correspondente', () => {
    render(<Badge tone="sucesso">Concluído</Badge>);
    expect(screen.getByText('Concluído')).toHaveClass('bg-success-bg');
  });
});
