import type { Config } from 'tailwindcss';
import designSystemConfig from '../../packages/design-system/tailwind.config';

const config: Config = {
  presets: [designSystemConfig],
  content: ['./app/**/*.{ts,tsx}', '../../packages/design-system/src/**/*.{ts,tsx}'],
};

export default config;
