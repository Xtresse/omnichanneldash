// /api/scenario — Claude tool-use loop for the Scenario Planning tab.
//
// Same architecture as /api/ask, with two differences:
//   1. Conversations are stored with kind="scenario" so they list under
//      the /scenarios sidebar separately from the /ask threads.
//   2. The system prompt is laser-focused on forecasting / pacing /
//      assumptions. The full rail manifest is still exposed so the
//      model can drill into actuals, but the new scenario rails
//      (get_pacing, run_scenario, get_retention_metrics,
//      get_rep_activity) are highlighted as the primary tools.
//
// The UI also passes a snapshot of the assumption sliders + horizon as
// `panelState`, which is injected into the system prompt so Claude
// answers in the context the user is currently looking at.

import { NextResponse } from "next/server";
import {
  appendMessage,
  createConversation,
  getConversation,
  setConversationTitle,
  listFacts,
  addFact,
} from "@/lib/store.js";
import { railManifest, runRail, RAIL_NAMES } from "@/lib/rails/rails.js";
import { newRequestCtx } from "@/lib/rails/dataset.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 8;
const MAX_QUESTION_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 12000;

const SYSTEM_PROMPT = `You are the scenario planning analyst inside Xtressé's omnichannel dashboard. The user is looking at a forward-looking landing forecast and wants to model where the business is going to end up by month, quarter, or year — by channel (B2B / ADCS / DTC), by product family, by rep, and on a daily-pacing basis.

Your job is to reason about the FUTURE, not just report the past. Use the data rails (tools) to ground every projection in actuals, then apply the user's stated assumptions or your own conservative defaults.

Primary tools for this tab:
- run_scenario — the headline forecasting tool. Pass horizon (eom/eoq/eoy/custom), per-channel growthPct, per-family growthPct, per-rep newAccountsPerDay overrides. Returns channel landings, family landings, rep new-account forecasts, and retention context.
- get_pacing — quick "where are we tracking" snapshot for a horizon. Use when the user just wants the current run rate without assumption overrides.
- get_rep_activity — daily-average new accounts per rep over a trailing window, projected forward. Trailing days defaults to 30; tune up to 180.
- get_retention_metrics — period repeat-purchase rate per channel + new vs returning order counts + sub vs one-time mix. Use when the user asks about retention, churn, or cohort behavior.

Plus all the actuals rails (get_kpis, get_time_series, get_product_family, get_top_skus, get_revenue_by_state, get_discount_usage, get_fulfillment_split, get_customer_dynamics, get_rep_performance, get_budget_vs_actual, get_variance, get_orders) for any drill-down the question demands.

Forecasting guidelines:
- ALWAYS cite the horizon you used and the trailing-window dates that anchored the run rate.
- Round all dollar amounts to whole dollars; format big numbers as $1.2M / $45K.
- Today is treated as in-flight and excluded from the divisor. Don't double-count it.
- The DTC feed didn't exist before 2026-04-01, so don't anchor DTC projections to anything earlier than that.
- When the user supplies assumptions in the panel (passed below as 'Current panel state'), use those exact values in run_scenario unless they tell you to override.
- For 'what if' questions, run two scenarios (current panel vs the new what-if) and present the delta.
- If the user shares a definition or recurring metric they care about, save it with remember_fact. Don't remember per-question trivia.
- After 2–3 turns of focused discussion, set the conversation title with set_thread_title if it's still "New scenario".
- Format for chat: short paragraphs, occasional bullet lists or compact tables. No giant headings.`;

const INTERNAL_TOOLS = [
  {
    name: "remember_fact",
    description:
      "Save a small piece of context (a definition, alias, preference, or recurring metric) so it's available on every future turn. Use sparingly — only for things the user would expect you to know next time.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact to remember. One sentence. Max 500 chars.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "set_thread_title",
    description:
      "Set a short, descriptive title for the current scenario thread. Call once when the topic is clear.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Max 60 chars." },
      },
      required: ["title"],
    },
  },
];

function buildTools() {
  const railTools = railManifest().map((r) => ({
    name: r.name,
    description: r.description,
    input_schema: r.input_schema || { type: "object", properties: {} },
  }));
  return [...railTools, ...INTERNAL_TOOLS];
}

function clampToolResult(value) {
  const s = JSON.stringify(value);
  if (s.length <= MAX_TOOL_RESULT_CHARS) return s;
  return (
    s.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n\n[truncated — ${s.length - MAX_TOOL_RESULT_CHARS} chars omitted; refine your query or call again with a smaller limit]`
  );
}

async function executeTool(name, input, ctx, conversationId) {
  if (name === "remember_fact") {
    const fact = await addFact({
      content: input.content,
      source: `scenario:${conversationId}`,
    });
    return { ok: true, factId: fact.id, content: fact.content };
  }
  if (name === "set_thread_title") {
    await setConversationTitle(conversationId, input.title);
    return { ok: true, title: input.title };
  }
  if (RAIL_NAMES.includes(name)) {
    return runRail(name, input, ctx);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function factsBlock(facts) {
  if (!facts.length) return "";
  const lines = facts.slice(0, 30).map((f) => `- ${f.content}`).join("\n");
  return `\n\nLearned facts (you remembered these previously — keep them in mind):\n${lines}`;
}

function panelStateBlock(panelState) {
  if (!panelState || typeof panelState !== "object") return "";
  const horizon = panelState.horizon || "eom";
  const growth = panelState.growthPct || {};
  const retention = panelState.retentionPct || {};
  const repOverrides = panelState.repNewAccountsPerDay || {};
  const familyGrowth = panelState.familyGrowthPct || {};
  const lines = [
    `Current panel state (the user is looking at this configuration right now):`,
    `- Horizon: ${horizon}${panelState.endDate ? ` (end ${panelState.endDate})` : ""}`,
    `- Growth%: B2B=${growth.B2B ?? 0}, ADCS=${growth.ADCS ?? 0}, DTC=${growth.DTC ?? 0}`,
  ];
  if (Object.keys(familyGrowth).length) {
    lines.push(
      `- Family growth%: ${Object.entries(familyGrowth)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
  }
  if (Object.keys(retention).length) {
    lines.push(
      `- Retention% overrides: ${Object.entries(retention)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
  }
  const repsTuned = Object.entries(repOverrides).filter(
    ([, v]) => v != null && v !== ""
  );
  if (repsTuned.length) {
    lines.push(
      `- Rep new-accounts/day overrides: ${repsTuned
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
  }
  return `\n\n${lines.join("\n")}\n\nWhen the user asks "what's the forecast" or similar, run run_scenario with these exact values. When they ask "what if X", run a second scenario with the modified value and compare.`;
}

async function callAnthropic({ tools, system, messages }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not set on the server." },
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
  let conversationId = body?.conversationId || null;
  const panelState = body?.panelState || null;
  if (!question) {
    return NextResponse.json({ ok: false, error: "Empty question" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { ok: false, error: `Question exceeds ${MAX_QUESTION_CHARS} chars` },
      { status: 400 }
    );
  }

  let conv = conversationId ? await getConversation(conversationId) : null;
  if (!conv) {
    conv = await createConversation({
      title: question.slice(0, 60),
      kind: "scenario",
    });
    conversationId = conv.id;
  }

  await appendMessage(conversationId, {
    role: "user",
    content: [{ type: "text", text: question }],
    createdAt: new Date().toISOString(),
  });

  const facts = await listFacts();
  const system =
    SYSTEM_PROMPT + factsBlock(facts) + panelStateBlock(panelState);
  const tools = buildTools();

  conv = await getConversation(conversationId);
  const messages = conv.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const ctx = newRequestCtx();
  const trace = [];
  const assistantBlocks = [];

  try {
    let iter = 0;
    while (iter < MAX_TOOL_ITERATIONS) {
      iter += 1;
      const resp = await callAnthropic({ tools, system, messages });
      const blocks = resp?.content || [];
      messages.push({ role: "assistant", content: blocks });
      for (const b of blocks) assistantBlocks.push(b);

      if (resp.stop_reason !== "tool_use") break;

      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const results = [];
      for (const tu of toolUses) {
        let resultPayload;
        try {
          const out = await executeTool(tu.name, tu.input || {}, ctx, conversationId);
          resultPayload = out;
          trace.push({ name: tu.name, input: tu.input, result: out });
        } catch (err) {
          resultPayload = { error: String(err?.message || err) };
          trace.push({
            name: tu.name,
            input: tu.input,
            result: resultPayload,
            error: true,
          });
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: clampToolResult(resultPayload),
        });
      }
      messages.push({ role: "user", content: results });
    }

    if (iter >= MAX_TOOL_ITERATIONS) {
      assistantBlocks.push({
        type: "text",
        text: `\n\n_(stopped after ${MAX_TOOL_ITERATIONS} tool iterations to avoid a loop — ask a more specific follow-up.)_`,
      });
    }

    await appendMessage(conversationId, {
      role: "assistant",
      content: assistantBlocks,
      createdAt: new Date().toISOString(),
      trace,
    });

    const replyText = assistantBlocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const updated = await getConversation(conversationId);
    return NextResponse.json({
      ok: true,
      conversationId,
      title: updated?.title || null,
      reply: replyText || "(no response)",
      trace,
      iterations: iter,
    });
  } catch (err) {
    await appendMessage(conversationId, {
      role: "assistant",
      content: [{ type: "text", text: `_Error: ${String(err?.message || err)}_` }],
      createdAt: new Date().toISOString(),
      trace,
    });
    return NextResponse.json(
      { ok: false, conversationId, error: String(err?.message || err), trace },
      { status: 500 }
    );
  }
}
