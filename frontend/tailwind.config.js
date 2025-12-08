/** @type {import('tailwindcss').Config} */
// Tailwind configuration
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'dark-primary': '#0a0a0c',
        'dark-secondary': '#111114',
        'dark-tertiary': '#18181b',
        'dark-elevated': '#1c1c20',
        'dark-hover': '#27272a',
        'accent-primary': '#6366f1',
        'accent-secondary': '#818cf8',
        'accent-glow': 'rgba(99, 102, 241, 0.15)',
        'border-default': 'rgba(255, 255, 255, 0.08)',
        'border-subtle': 'rgba(255, 255, 255, 0.04)',
      },
      backgroundImage: {
        'gradient-mesh': 'radial-gradient(at 40% 20%, rgba(99, 102, 241, 0.08) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(16, 185, 129, 0.05) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(99, 102, 241, 0.05) 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
}