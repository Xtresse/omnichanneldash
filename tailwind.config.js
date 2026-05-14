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
        rulestrong: "rgb(var(--rulestrong) / <alpha-value>)",
        brown: "rgb(var(--brown) / <alpha-value>)",
        browndeep: "rgb(var(--browndeep) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        b2b: "rgb(var(--b2b) / <alpha-value>)",
        dtc: "rgb(var(--dtc) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        tan: "rgb(var(--tan) / <alpha-value>)",
        // Status tokens — pulled from the same --status-* vars used by JS
        // components for delta colors, so the entire app stays in lock-step.
        good: "rgb(var(--status-good) / <alpha-value>)",
        warn: "rgb(var(--status-warn) / <alpha-value>)",
        bad:  "rgb(var(--status-bad)  / <alpha-value>)",
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
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        tile: "var(--shadow-tile)",
        banner: "var(--shadow-banner)",
        focus: "var(--shadow-focus)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        mid: "var(--dur-mid)",
      },
      letterSpacing: {
        eyebrow: "0.18em",
        chip: "0.14em",
      },
    },
  },
  plugins: [],
};
