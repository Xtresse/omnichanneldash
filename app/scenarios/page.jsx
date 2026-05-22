import ScenariosUI from "@/components/scenarios/ScenariosUI.jsx";

export const metadata = {
  title: "Scenario Planning · Xtressé Omni",
  description:
    "Forward-looking pacing and landing forecasts by channel, product family, and rep — with a Claude-powered planning assistant.",
};

// Fully client-driven UI with live snapshot/chat hits to the server.
export const dynamic = "force-dynamic";

export default function ScenariosPage() {
  return <ScenariosUI />;
}
