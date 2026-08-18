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
          // Also the login screen's dark side panel (LoginForm.jsx) — do not
          // repoint these two at the new sidebar palette below, and do not
          // rename them; sidebar-only tokens live under `sidebar.*` instead.
          sidebar: '#1a1d23',
          'sidebar-hover': '#252a33',
          border: '#d8dce3',
          muted: '#6b7280',
          accent: '#2563eb',
        },
        sidebar: {
          bg: '#11161D',
          text: '#F4F6F8',
          'text-muted': '#8B95A3',
          'text-section': '#66717F',
          border: 'rgba(255,255,255,0.06)',
          hover: 'rgba(255,255,255,0.04)',
          active: 'rgba(37,99,235,0.10)',
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
