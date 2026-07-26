import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/Button';

function PainelRecrutador() {
  return (
    <div data-theme="light" className="bg-bg text-text p-6 rounded-panel border border-border">
      <h2 className="font-display text-lg mb-2">Painel do recrutador — claro</h2>
      <p className="font-ui text-sm text-text-secondary mb-4">Densidade é feature. Violeta reservado a ação/seleção.</p>
      <Button>Publicar vaga</Button>
    </div>
  );
}

function PainelRecrutadorEscuro() {
  return (
    <div data-theme="dark" className="bg-bg text-text p-6 rounded-panel border border-border">
      <h2 className="font-display text-lg mb-2">Painel do recrutador — escuro</h2>
      <Button>Publicar vaga</Button>
    </div>
  );
}

function AvaliacaoCandidato() {
  return (
    <div className="pr-assessment bg-bg text-text p-6 rounded-panel border border-border">
      <h2 className="font-display text-lg mb-2">Avaliação do candidato</h2>
      <p className="font-ui text-sm text-text-secondary mb-4">
        Cinza puro, sem violeta, sem tema escuro — instrumento de medida, não superfície de marca.
      </p>
      <button className="rounded-control px-4 py-2 border border-border-strong bg-surface text-text">
        Próximo bloco
      </button>
    </div>
  );
}

const meta: Meta = {
  title: 'Fundação/Três Contratos Visuais',
};

export default meta;
type Story = StoryObj;

export const OsTresContratos: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
      <PainelRecrutador />
      <PainelRecrutadorEscuro />
      <AvaliacaoCandidato />
    </div>
  ),
};
