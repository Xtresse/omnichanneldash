import { ImageResponse } from "next/og";

// iPhone home-screen icon (apple-touch-icon). Full-bleed square — iOS applies
// its own rounded-squircle mask. Espresso tile, orange "XTR" brand mark, and a
// per-app code so the seven dashboards are distinguishable at a glance.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const CODE = "OMNI";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#241712",
        }}
      >
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: "#f0922e", lineHeight: 1, letterSpacing: 2 }}>
          XTR
        </div>
        <div style={{ width: 48, height: 4, background: "rgba(240,146,46,0.55)", borderRadius: 2, marginTop: 12, marginBottom: 10 }} />
        <div style={{ display: "flex", fontSize: 26, fontWeight: 600, letterSpacing: 7, color: "#ede3d2" }}>
          {CODE}
        </div>
      </div>
    ),
    { ...size }
  );
}
