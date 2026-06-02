// PWA manifest — picked up automatically by Next.js 14 App Router.
// Lets Sam "Add to Home Screen" on iPhone for a native-feeling launch.
export default function manifest() {
  return {
    name: "Xtresse Omni Channel Dashboard",
    short_name: "XTR OMNI",
    description:
      "B2B + ADCS + DTC unified analytics for Xtresse, sourced from Windsor.ai → Shopify.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f1ea",
    theme_color: "#f0922e",
    icons: [
      // Next.js App Router serves app/icon.svg at /icon and the generated
      // PNG apple-touch-icon at /apple-icon.
      { src: "/icon", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
