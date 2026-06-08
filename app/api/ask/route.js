// /api/ask — Claude tool-use loop over the data rails.
//
// Flow per turn:
//   1. Load conversation (or create one) + the learned-facts list.
//   2. Build the Anthropic /v1/messages request with:
//        - the rail manifest exposed as `tools`
//        - 2 internal tools: remember_fact, set_thread_title
//        - system prompt that tells Claude how to use them
//   3. Loop: while the response stop_reason === "tool_use", run the
//      requested tools, append `tool_result` blocks, send again.
//      Cap at 8 iterations as a safety belt.
//   4. Persist the user message + the full assistant turn (text +
//      tool calls + tool results) so the UI can replay it later.
//   5. Return the final assistant text plus a structured trace of
//      tool calls so the UI can render expandable "data viewed" cards.

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

// Cap any single tool result at this many JSON characters before sending
// it back to Claude. Long tool results are the main token sink in a
// multi-turn loop; truncating with a notice is safer than blowing context.
const MAX_TOOL_RESULT_CHARS = 12000;

const SYSTEM_PROMPT = `You are the analyst inside Xtressé's omnichannel dashboard. The user is operating a live FP&A-grade view of their B2B + ADCS + DTC sales data.

You answer questions by calling the data rails (tools) below. Treat the rails as your only source of truth — never invent numbers. If a question can't be answered from the rails, say so plainly.

Guidelines:
- Default time window when the user doesn't specify one: month-to-date (preset "mtd").
- For "how are we doing vs..." questions, prefer get_variance with vs="prior", "yoy", or "budget".
- For trend questions, use get_time_series. For "why is X high/low" questions, drill down with get_top_skus, get_revenue_by_state, get_rep_performance, or get_orders.
- Cite the period you used in your answer (e.g., "MTD through May 14"). Round dollars to whole numbers; format big numbers as $1.2M / $45K.
- Channels B2B, ADCS, DTC are mutually exclusive and sum to total net sales.
- Net sales = subtotal (post-discount, pre-shipping/tax) − refunds.
- DTC backfill: the store's DTC channel ramped on 2026-04-01. DTC numbers before that date are essentially zero — flag this if the user asks about historical DTC.
- If the user shares context worth remembering across sessions (a definition, a SKU alias, a recurring metric they care about), use the remember_fact tool. Don't remember per-question trivia.
- If the conversation has settled on a clear topic, set the thread title with set_thread_title (one-time, short — "May variance review", not "Discussion of May").
- Format for chat: short paragraphs, occasional bullet lists or compact tables, no large headings.`;

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
      "Set a short, descriptive title for the current conversation thread. Call once when the topic is clear.",
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
      source: `conv:${conversationId}`,
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
  const lines = facts
    .slice(0, 30)
    .map((f) => `- ${f.content}`)
    .join("\n");
  return `\n\nLearned facts (you remembered these previously — keep them in mind):\n${lines}`;
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
      {
        ok: false,
        error: "ANTHROPIC_API_KEY is not set on the server.",
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
  let conversationId = body?.conversationId || null;
  if (!question) {
    return NextResponse.json({ ok: false, error: "Empty question" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { ok: false, error: `Question exceeds ${MAX_QUESTION_CHARS} chars` },
      { status: 400 }
    );
  }

  // Resolve / create conversation.
  let conv = conversationId ? await getConversation(conversationId) : null;
  if (!conv) {
    conv = await createConversation({ title: question.slice(0, 60) });
    conversationId = conv.id;
  }

  // Persist the user turn immediately so the UI sees it on reload even
  // if the model call later fails.
  await appendMessage(conversationId, {
    role: "user",
    content: [{ type: "text", text: question }],
    createdAt: new Date().toISOString(),
  });

  const facts = await listFacts();
  const system = SYSTEM_PROMPT + factsBlock(facts);
  const tools = buildTools();

  // Build the Claude message thread from persisted history. Each stored
  // message is already in Anthropic content-block format.
  // We refresh `conv` to include the just-appended user message.
  conv = await getConversation(conversationId);
  const messages = conv.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const ctx = newRequestCtx();
  const trace = []; // { name, input, result } per tool invocation
  const assistantBlocks = []; // accumulated content blocks for THIS turn

  try {
    let iter = 0;
    while (iter < MAX_TOOL_ITERATIONS) {
      iter += 1;
      const resp = await callAnthropic({ tools, system, messages });
      const blocks = resp?.content || [];
      // Push the assistant's response as the next message in the thread
      // for any subsequent tool-result iterations.
      messages.push({ role: "assistant", content: blocks });
      // Track everything so the UI can show text + tool usage.
      for (const b of blocks) assistantBlocks.push(b);

      if (resp.stop_reason !== "tool_use") {
        break;
      }

      // Run every tool_use block and append a single user message that
      // contains all the tool_results (Anthropic API requires them in
      // one user message immediately following the assistant's tool_use).
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

    // Persist the assistant turn (concatenated blocks).
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
    // Even on failure, leave the user message in the conversation so the
    // UI can show the partial state. Append a minimal error assistant
    // turn to surface the failure in the thread.
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
