/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f5f1ea",     // page background — matches leadership PAGE_BG
        paper2: "#faf7f2",    // soft cream — matches leadership SOFT_BG (filter bar, subtotal rows)
        card: "#ffffff",      // pure white card surface — matches leadership
        ink: "#2b1a10",
        inksoft: "#5a4232",
        rule: "#d4d0c8",      // matches leadership BORDER
        brown: "#5c2a1a",     // RUST primary brand — matches leadership RUST
        browndeep: "#3f1c0f", // section banners — matches leadership banner color
        accent: "#7a3a2d",    // matches leadership RUST_LT
        b2b: "#5c2a1a",
        dtc: "#3a7a6f",
        muted: "#8a7359",
        tan: "#a89478",
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
