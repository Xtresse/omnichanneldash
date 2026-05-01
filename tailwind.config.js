/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f4ede0",
        paper2: "#ece3d3",
        ink: "#2b1a10",
        inksoft: "#5a4232",
        rule: "#d8cab2",
        brown: "#3c1f15",
        accent: "#7a3d23",
        b2b: "#7a3d23",
        dtc: "#3a7a6f",
        muted: "#8a7359",
      },
      fontFamily: {
        serif: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        // 16px base on inputs to prevent iOS auto-zoom
        body: ["16px", { lineHeight: "1.5" }],
      },
      minHeight: {
        touch: "44px",
      },
    },
  },
  plugins: [],
};
