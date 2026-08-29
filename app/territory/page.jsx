import TerritoryUI from "@/components/territory/TerritoryUI.jsx";

export const metadata = {
  title: "Territory · Xtressé Omni",
  description: "Live B2B sales-rep territory map, pulled from Shopify order-tag data — replaces the static coverage workbook.",
};

// Fully client-driven, hits the server for live snapshot + diff state.
export const dynamic = "force-dynamic";

export default function TerritoryPage() {
  return <TerritoryUI />;
}
