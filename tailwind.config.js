/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette — values are CSS variables defined in app/globals.css.
        // The rgb(var(--token) / <alpha-value>) shape lets Tailwind utilities
        // like `bg-paper/50` keep working with alpha modifiers, AND it lets
        // the dark-mode @media block in globals.css flip every brand class
        // automatically without duplicating the palette here.
        paper: "rgb(var(--paper) / <alpha-value>)",
        paper2: "rgb(var(--paper2) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        inksoft: "rgb(var(--inksoft) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        brown: "rgb(var(--brown) / <alpha-value>)",
        browndeep: "rgb(var(--browndeep) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        b2b: "rgb(var(--b2b) / <alpha-value>)",
        dtc: "rgb(var(--dtc) / <alpha-value>)",
        adcs: "rgb(var(--adcs) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        tan: "rgb(var(--tan) / <alpha-value>)",
        favorable: "rgb(var(--favorable) / <alpha-value>)",
        partial: "rgb(var(--partial) / <alpha-value>)",
        unfavorable: "rgb(var(--unfavorable) / <alpha-value>)",
        neutral: "rgb(var(--neutral) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["'Cormorant Garamond'", "Georgia", "serif"],
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        body: ["16px", { lineHeight: "1.5" }],
      },
      minHeight: {
        touch: "44px",
      },
    },
  },
  plugins: [],
};
