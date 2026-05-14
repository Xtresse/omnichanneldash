import "./globals.css";

export const metadata = {
  title: "Xtresse Omnichannel Dashboard",
  description: "B2B + ADCS + DTC unified analytics — Xtresse",
};

// CRITICAL for mobile: render at device width, allow up to 5x zoom for
// accessibility, paint the iOS notch / Android status bar in brand brown,
// and let safe-area insets reach the layout via env() variables.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#5c2a1a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Preconnect to fonts.gstatic so the @import in globals.css
            doesn't pay a full handshake on first paint. Has no effect on
            cached visits but shaves 80–150ms on cold loads, which is
            disproportionately visible because Cormorant is used in every
            section heading and KPI value. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
