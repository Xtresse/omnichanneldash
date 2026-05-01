"use client";

export default function MarketingPlaceholder({ label }) {
  return (
    <div className="h-60 md:h-80 w-full flex flex-col items-center justify-center bg-paper2/40 border border-dashed border-rule rounded-md">
      <div className="font-serif text-3xl text-muted/50">—</div>
      <div className="font-sans text-xs text-muted mt-2">{label}</div>
      <div className="font-sans text-[10px] text-muted/70 mt-1 max-w-[220px] text-center px-3">
        Authorize Google Ads, Meta, TikTok, or Klaviyo on Windsor.ai to activate.
      </div>
    </div>
  );
}
