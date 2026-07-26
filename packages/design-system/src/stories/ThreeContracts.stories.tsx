import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/Button';

// ---------------------------------------------------------------------------
// Escopo desta fundação (Task 15): painel do recrutador (claro + escuro) e a
// avaliação do candidato isolada (`.pr-assessment`). O brief original descrevia
// um terceiro contrato — carreiras white-label — que NÃO está coberto aqui:
// não existe ainda vocabulário de tokens para override por tenant (o que um
// tenant pode sobrescrever, o que fica travado por contraste/acessibilidade,
// qual o fallback). Construir isso sem essa decisão arriscaria uma página
// pública de carreiras sobre uma base inexistente — por isso fica de fora,
// deliberadamente, como uma task própria.
// ---------------------------------------------------------------------------

function EscopoNota() {
  return (
    <p
      style={{
        font: 'var(--pr-text-dense)',
        color: 'var(--pr-slate-50)',
        maxWidth: '760px',
        marginBottom: '1rem',
      }}
    >
      Contratos visuais implementados nesta fundação: painel do recrutador (claro e escuro) e
      avaliação do candidato isolada. <strong>Carreiras white-label não está incluído</strong> — o
      vocabulário de tokens para override por tenant ainda não foi decidido; fica como task própria.
    </p>
  );
}

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
  title: 'Fundação/Contratos Visuais',
};

export default meta;
type Story = StoryObj;

export const PainelClaroEscuroEAvaliacao: Story = {
  name: 'Painel claro · Painel escuro · Avaliação',
  render: () => (
    <div>
      <EscopoNota />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <PainelRecrutador />
        <PainelRecrutadorEscuro />
        <AvaliacaoCandidato />
      </div>
    </div>
  ),
};

export const IsolamentoDaAvaliacaoNoTemaEscuro: Story = {
  name: 'Isolamento — avaliação dentro de tema escuro',
  render: () => (
    <div>
      <p
        style={{
          font: 'var(--pr-text-dense)',
          color: 'var(--pr-slate-50)',
          maxWidth: '640px',
          marginBottom: '1rem',
        }}
      >
        Regressão visual do escopo <code>.pr-assessment</code>: a avaliação abaixo está aninhada
        dentro de um contêiner com <code>data-theme=&quot;dark&quot;</code>. Se qualquer traço de
        violeta, vidro ou cinza do tema escuro aparecer dentro do cartão, o isolamento vazou.
      </p>
      <div
        data-theme="dark"
        className="bg-bg text-text p-6 rounded-panel border border-border"
        style={{ maxWidth: '420px' }}
      >
        <p className="font-ui text-xs text-text-secondary mb-3">Painel escuro (contêiner ancestral)</p>
        <AvaliacaoCandidato />
      </div>
    </div>
  ),
};
