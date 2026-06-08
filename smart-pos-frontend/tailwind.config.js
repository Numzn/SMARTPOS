/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Roboto',
          'sans-serif',
        ],
        mono: ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#f4f5f7',
          raised: '#ffffff',
          sidebar: '#1a1d23',
          'sidebar-hover': '#252a33',
          border: '#d8dce3',
          muted: '#6b7280',
          accent: '#2563eb',
        },
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
