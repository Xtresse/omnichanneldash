import "./globals.css";

export const metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"
  ),
  title: "Xtresse Omni Channel Dashboard",
  applicationName: "XTR OMNI",
  description: "B2B + ADCS + DTC unified analytics — Xtresse",
  // Home-screen title when saved to iPhone.
  appleWebApp: { capable: true, title: "XTR OMNI", statusBarStyle: "default" },
  openGraph: {
    title: "Xtresse Omni Channel Dashboard",
    description: "B2B + ADCS + DTC unified analytics — Xtresse",
    type: "website",
  },
};

// CRITICAL for mobile: render at device width, allow up to 5x zoom for
// accessibility, paint the iOS notch / Android status bar in brand brown,
// and let safe-area insets reach the layout via env() variables.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f0922e",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
