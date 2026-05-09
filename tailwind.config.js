/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}', './mockups/**/*.html'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0EA5E9' },
        accent: { DEFAULT: '#8B5CF6' },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#0EA5E9',
      },
      fontFamily: {
        heading: ['Poppins', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      maxWidth: {
        reading: '64rem',
        dashboard: '80rem',
      },
    },
  },
  plugins: [],
};
