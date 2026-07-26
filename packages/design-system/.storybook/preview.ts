import '../tokens.css';
import '../src/index.css';
import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'claro',
      values: [
        { name: 'claro', value: 'var(--pr-bg)' },
        { name: 'escuro', value: '#0E0A18' },
      ],
    },
  },
};

export default preview;
