import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PanelLayout } from '../PanelLayout';

describe('PanelLayout', () => {
  it('mostra tenant/staff logados, renderiza os filhos, e chama onSair ao clicar em sair', () => {
    const onSair = vi.fn();
    render(
      <PanelLayout nomeStaff="Ana Recrutadora" nomeTenant="Empresa X" onSair={onSair}>
        <p>Conteúdo da página</p>
      </PanelLayout>,
    );
    expect(screen.getByText('Empresa X')).toBeInTheDocument();
    expect(screen.getByText('Ana Recrutadora')).toBeInTheDocument();
    expect(screen.getByText('Conteúdo da página')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onSair).toHaveBeenCalledTimes(1);
  });
});
