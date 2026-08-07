import type { Config } from 'tailwindcss';

// Дизайн-система Family OS: спокойный «семейный архив/гроссбух», а не маркетинговый лендинг.
// Палитра сознательно уходит от клише «кремовый + терракота» и «чёрный + неон».
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1B2420', // основной тёмный — глубокий зелёно-чёрный, «переплёт книги»
          soft: '#2C3A33',
        },
        paper: {
          DEFAULT: '#F5F3EE', // бумажный, не кремовый — нейтральный тёплый фон
          dim: '#EDEAE1',
          card: '#FFFFFF',
        },
        moss: {
          50: '#EEF2ED',
          100: '#D7E1D3',
          300: '#96AB8D',
          500: '#4B6355', // основной акцент бренда
          600: '#3B4F43',
          700: '#2C3B32',
        },
        clay: {
          DEFAULT: '#A85C32', // тёплый ржаво-охристый — для конфиденциального/предупреждений
          soft: '#E7C9B4',
        },
        line: '#DAD5C8', // тонкие разделители
        gold: '#B08B3F', // редкие акценты «подтверждено/важно»
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        card: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(27,36,32,0.06), 0 1px 0 rgba(27,36,32,0.04)',
      },
    },
  },
  plugins: [],
};
export default config;
