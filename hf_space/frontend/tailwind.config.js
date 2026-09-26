/** Design tokens from docs/DESIGN.md */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#0F766E", light: "#CCFBF1", dark: "#115E59" },
        ink: "#0F172A",
        muted: "#64748B",
        line: "#E2E8F0",
        page: "#F8FAFC",
        hover: "#F1F5F9",
        trace: "#2563EB",
        high: { DEFAULT: "#DC2626", bg: "#FEF2F2" },
        medium: { DEFAULT: "#D97706", bg: "#FFFBEB" },
        low: { DEFAULT: "#2563EB", bg: "#EFF6FF" },
        success: { DEFAULT: "#16A34A", bg: "#F0FDF4" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { card: "10px", ctl: "8px" },
      boxShadow: { card: "0 1px 2px rgba(15, 23, 42, 0.04)" },
      maxWidth: { content: "1200px" },
    },
  },
  plugins: [],
};
