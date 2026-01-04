/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./utils/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'theme-background': 'var(--background)',
        'theme-surface': 'var(--surface)',
        'theme-surface-2': 'var(--surface-2)',
        'theme-surface-3': 'var(--surface-3)',
        'theme-primary-text': 'var(--primary-text)',
        'theme-secondary-text': 'var(--secondary-text)',
        'theme-border': 'var(--border)',
        'theme-hover': 'var(--hover)',

        'primary': '#1e3a8a',
        'secondary': '#1d4ed8',
        'accent': '#3b82f6',
        'success': '#22c55e',
        'warning': '#facc15',
        'error': '#ef4444',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0, transform: 'translateY(-10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
