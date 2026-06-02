"use client";

import { useState } from "react";
import Markdown from "./Markdown.jsx";

// Render a single persisted message. Each message has `role` and `content`
// (Anthropic content-block shape: text + tool_use + tool_result blocks).
// We collapse the latter two into compact "Data viewed" cards.

function fmtJson(value) {
  try {
    if (typeof value === "string") {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolCallCard({ name, input, result }) {
  const [open, setOpen] = useState(false);
  const errored =
    result && typeof result === "object" && (result.error || result.errored);
  return (
    <div
      className={`my-2 rounded-md border ${
        errored ? "border-red-400/60" : "border-rule"
      } bg-paper2/60`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-muted">›</span>
          <span className="font-mono text-[11px] text-inksoft truncate">
            {name}
          </span>
          {input && Object.keys(input).length > 0 && (
            <span className="font-mono text-[11px] text-muted truncate">
              ({summarizeInput(input)})
            </span>
          )}
        </div>
        <span className="font-sans text-[10px] text-muted shrink-0">
          {open ? "Hide" : "Inspect"}
        </span>
      </button>
      {open && (
        <div className="border-t border-rule px-3 py-2 space-y-2">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-wider text-muted mb-1">
              Input
            </div>
            <pre className="font-mono text-[11px] bg-card border border-rule rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {fmtJson(input)}
            </pre>
          </div>
          <div>
            <div className="font-sans text-[10px] uppercase tracking-wider text-muted mb-1">
              Result
            </div>
            <pre className="font-mono text-[11px] bg-card border border-rule rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-72">
              {fmtJson(result)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeInput(input) {
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    if (typeof v === "object") {
      parts.push(`${k}=${JSON.stringify(v).slice(0, 30)}`);
    } else {
      parts.push(`${k}=${String(v).slice(0, 30)}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
}

function ToolResultBubble({ block }) {
  // tool_result blocks live on the user side of the wire but they're
  // pure data the model just consumed. Render them only as a thin marker
  // — the matching ToolCallCard above already shows the payload.
  return (
    <div className="text-[11px] font-mono text-muted px-1">
      ↳ tool result delivered
    </div>
  );
}

export function MessageView({ message, traceById }) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: "text", text: String(message.content || "") }];

  if (message.role === "user") {
    // For user turns we only ever have a single text block, but be safe.
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] bg-brown text-ink rounded-xl px-3 py-2 font-sans text-[13px] whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  // Assistant turn — interleave text + collapsible tool-use cards.
  return (
    <div className="flex flex-col items-start max-w-[92%] gap-1">
      {blocks.map((b, i) => {
        if (b.type === "text") {
          if (!b.text || !b.text.trim()) return null;
          return (
            <div
              key={i}
              className="bg-card border border-rule rounded-xl px-3 py-2 max-w-full"
            >
              <Markdown text={b.text} />
            </div>
          );
        }
        if (b.type === "tool_use") {
          // Find the matching tool_result from the trace (which the API
          // sent back alongside the message). Falls back to "(no result)".
          const result = traceById?.get(b.id) || null;
          return (
            <ToolCallCard
              key={i}
              name={b.name}
              input={b.input}
              result={result}
            />
          );
        }
        if (b.type === "tool_result") {
          return <ToolResultBubble key={i} block={b} />;
        }
        return null;
      })}
    </div>
  );
}

export default function Thread({ messages }) {
  // Collect tool_use_id → result by walking message blocks. tool_result
  // blocks live on user turns; tool_use blocks live on assistant turns.
  const traceById = new Map();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_result") {
        try {
          const parsed =
            typeof b.content === "string"
              ? (() => {
                  try {
                    return JSON.parse(b.content);
                  } catch {
                    return b.content;
                  }
                })()
              : b.content;
          traceById.set(b.tool_use_id, parsed);
        } catch {
          traceById.set(b.tool_use_id, b.content);
        }
      }
    }
    // Also merge in any per-message `trace` array the API attached on
    // assistant turns — that's the canonical record of what ran.
    if (m.role === "assistant" && Array.isArray(m.trace)) {
      // trace items don't carry the tool_use id, but the user-side
      // tool_result blocks already do. Skip here.
    }
  }

  return (
    <div className="space-y-3 px-3 py-4 md:px-6 md:py-6">
      {messages.map((m, i) => (
        <MessageView key={i} message={m} traceById={traceById} />
      ))}
    </div>
  );
}
