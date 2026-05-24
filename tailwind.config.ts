import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-display)", "Georgia", "Cambria", "Times New Roman", "serif"],
        display: ["var(--font-display)", "Georgia", "Cambria", "Times New Roman", "serif"]
      },
      colors: {
        accent: {
          50: "#eef4f8",
          100: "#d6e3ec",
          200: "#aec8d9",
          300: "#85adc7",
          400: "#5c93b4",
          500: "#3f7a9b",
          600: "#365f7e",
          700: "#2d4f69",
          800: "#243f54",
          900: "#1b2f3f"
        }
      },
      keyframes: {
        "popover-in": {
          "0%": { opacity: "0", transform: "scale(0.96) translateY(-2px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" }
        },
        "answer-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "popover-in": "popover-in 150ms ease-out",
        "answer-in": "answer-in 200ms ease-out"
      }
    }
  },
  plugins: []
};

export default config;
