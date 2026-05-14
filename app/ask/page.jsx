import AskUI from "@/components/ask/AskUI.jsx";

export const metadata = {
  title: "Ask · Xtressé Omni",
  description:
    "Conversational analyst over the Xtressé omnichannel data rails — powered by Claude.",
};

// Don't pre-render — the UI is fully client-driven and hits the server
// for live conversation + facts state.
export const dynamic = "force-dynamic";

export default function AskPage() {
  return <AskUI />;
}
