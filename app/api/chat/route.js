import { NextResponse } from "next/server";

// Anthropic Messages API endpoint.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are an analytics assistant embedded inside the Xtresse Omni Channel Dashboard.

You answer questions about Xtresse's omnichannel sales data based on the JSON context the user supplies. Be concise. Use plain language and cite specific numbers from the context.

Important data conventions:
- "B2B", "ADCS", and "DTC" are mutually exclusive channels and sum to total net sales.
- B2B is defined by canonical rep tags (the rep registry in the context).
- ADCS = orders tagged "adcs" or "advanced derm".
- DTC = everything else. Windsor only began returning DTC data on 2026-04-01, so DTC numbers before that date are essentially zero.
- "Net" sales = gross − discounts − refunds.
- The rep performance table groups reps into Existing / New / 1099 territories.
- Time-series buckets are either daily (windows ≤ 100 days) or monthly. The granularity field in the context tells you which.

When you compute totals or compare numbers, show the math briefly. If the data needed isn't in the context, say so rather than guessing.

Format responses for a chat panel: short paragraphs, occasional bullet lists, no headings unless truly necessary.`;

// Trim the data payload to keep token cost reasonable. Drop the heavy
// per-order list and anything redundant — keep the analytical aggregates.
function buildContext(data) {
  if (!data) return null;
  return {
    period: {
      from: data.from || null,
      to: data.to || null,
      preset: data.preset || null,
    },
    granularity: data.granularity,
    generatedAt: data.generatedAt,
    orderCount: data.orderCount,
    kpis: data.kpis,
    monthlySeries: data.monthlySeries,
    cumulativeYTD: data.cumulativeYTD,
    productFamily: data.productFamily,
    customerDynamics: data.customerDynamics,
    repeatRate: data.repeatRate,
    subVsOneTime: data.subVsOneTime,
    revenueByState: data.revenueByState,
    discountUsage: data.discountUsage,
    fulfillmentSplit: data.fulfillmentSplit,
    repPerformance: data.repPerformance,
    topSKUs: data.topSKUs,
    repsList: data.repsList,
  };
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.",
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const question = String(body?.question || "").trim();
  const data = body?.data;
  const history = Array.isArray(body?.history) ? body.history : [];

  if (!question) {
    return NextResponse.json({ ok: false, error: "Empty question" }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ ok: false, error: "Question is too long" }, { status: 400 });
  }

  const context = buildContext(data);
  const dataBlock = context
    ? `<dashboard_data>\n${JSON.stringify(context, null, 0)}\n</dashboard_data>`
    : "<dashboard_data>(no data loaded)</dashboard_data>";

  // Keep up to the last 6 turns of history for continuity.
  const trimmedHistory = history
    .slice(-6)
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length < 4000
    );

  const messages = [
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${dataBlock}\n\nQuestion: ${question}`,
    },
  ];

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Anthropic API ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    const reply = (json?.content || [])
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      ok: true,
      reply: reply || "(no response)",
      usage: json?.usage || null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
