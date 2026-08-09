import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--pr-bg)',
        surface: 'var(--pr-surface)',
        'surface-sunken': 'var(--pr-surface-sunken)',
        border: 'var(--pr-border)',
        'border-strong': 'var(--pr-border-strong)',
        text: 'var(--pr-text)',
        'text-secondary': 'var(--pr-text-secondary)',
        accent: 'var(--pr-accent)',
        'on-accent': 'var(--pr-on-accent)',
        'success-bg': 'var(--pr-state-success-bg)',
        'success-text': 'var(--pr-state-success)',
        'warning-bg': 'var(--pr-state-warning-bg)',
        'warning-text': 'var(--pr-state-warning)',
        'danger-bg': 'var(--pr-state-danger-bg)',
        'danger-text': 'var(--pr-state-danger)',
      },
      borderRadius: {
        control: 'var(--pr-r-control)',
        card: 'var(--pr-r-card)',
        panel: 'var(--pr-r-panel)',
      },
      fontFamily: {
        display: 'var(--pr-font-display)',
        ui: 'var(--pr-font-ui)',
        num: 'var(--pr-font-num)',
      },
    },
  },
  plugins: [],
};

export default config;
