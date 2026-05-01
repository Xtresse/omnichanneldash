import "./globals.css";

export const metadata = {
  title: "Xtresse Omnichannel",
  description: "B2B + DTC unified analytics — Xtresse",
};

// CRITICAL for mobile: tells iOS/Android browsers to render at device width
// rather than scaling a 980px desktop layout down.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
