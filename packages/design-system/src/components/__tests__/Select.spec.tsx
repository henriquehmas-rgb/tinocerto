import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../Select';

describe('Select', () => {
  it('chama onChange com o value selecionado ao escolher uma opção', async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Etapa"
        value="triagem"
        onChange={onChange}
        options={[
          { value: 'triagem', label: 'Triagem' },
          { value: 'entrevista', label: 'Entrevista' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Entrevista'));
    expect(onChange).toHaveBeenCalledWith('entrevista');
  });
});
