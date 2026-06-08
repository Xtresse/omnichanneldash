// PWA manifest — picked up automatically by Next.js 14 App Router.
// Lets Sam "Add to Home Screen" on iPhone for a native-feeling launch.
export default function manifest() {
  return {
    name: "Xtresse Omni Channel Dashboard",
    short_name: "Xtresse Omni",
    description:
      "B2B + ADCS + DTC unified analytics for Xtresse, sourced directly from Shopify.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f1ea",
    theme_color: "#e6a403",
    icons: [
      // Single SVG icon — Next.js App Router serves app/icon.svg at /icon.
      {
        src: "/icon",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
