/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/react-app/**/*.{js,ts,jsx,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        app: {
          ink: "var(--app-ink)",
          muted: "var(--app-text-muted)",
          surface: "var(--app-surface)",
          border: "var(--app-border-input)",
        },
      },
    },
  },
};
