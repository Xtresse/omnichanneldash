import { ImageResponse } from "next/og";

// Open Graph card shown when a link to this app is saved/shared (iMessage,
// Slack, etc.). Cream brand card: XTRESSÉ wordmark, dashboard name, orange bar.
export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Xtressé — Omni Channel Dashboard";

const NAME = "Omni Channel Dashboard";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#f5f1ea",
          padding: 96,
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 14, color: "#8a7359" }}>
          XTRESSÉ
        </div>
        <div style={{ display: "flex", fontSize: 100, fontWeight: 800, color: "#2b1a10", marginTop: 10, lineHeight: 1.05 }}>
          {NAME}
        </div>
        <div style={{ width: 170, height: 12, background: "#f0922e", borderRadius: 6, marginTop: 34 }} />
      </div>
    ),
    { ...size }
  );
}
