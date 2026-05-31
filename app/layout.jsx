import "./globals.css";

export const metadata = {
  title: "Xtresse Omni Channel Dashboard",
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
  themeColor: "#e6a403",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
