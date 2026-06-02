"use client";

import { useState, useRef, useEffect } from "react";

const SUGGESTIONS = [
  "Which rep had the biggest growth this period?",
  "How does B2B compare to last month?",
  "What product family is trending up?",
  "Top 3 states by net sales right now?",
];

/**
 * Floating chat panel that posts dashboard data + the user's question to
 * /api/chat. The API route forwards to Anthropic and returns the reply.
 *
 * State:
 *   - open       : whether the panel is expanded
 *   - messages   : full conversation history (user + assistant)
 *   - input      : current draft
 *   - loading    : a request is in flight
 *
 * Notes:
 *   - History is sent to the server (last 6 turns) so the model has
 *     conversational context.
 *   - The "Clear" button resets the conversation.
 */
export default function ChatPanel({ data }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(question) {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    setError(null);
    const newMessages = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          data,
          history: messages, // before adding current
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const errMsg = json?.error || `${res.status} ${res.statusText}`;
        setError(errMsg);
        setMessages((m) => [...m, { role: "assistant", content: `_Error: ${errMsg}_` }]);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: json.reply }]);
    } catch (err) {
      const msg = String(err?.message || err);
      setError(msg);
      setMessages((m) => [...m, { role: "assistant", content: `_Error: ${msg}_` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-40 min-h-touch bg-brown text-ink rounded-full shadow-lg hover:bg-browndeep transition flex items-center gap-2 px-4 py-3 font-sans text-sm font-semibold"
          aria-label="Open Ask Claude chat"
        >
          <SparkleIcon />
          <span>Ask Claude</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Ask Claude — dashboard chat"
          className="fixed inset-x-0 bottom-0 z-40 md:inset-auto md:bottom-6 md:right-6 md:w-[420px] md:max-h-[640px] flex flex-col bg-card border border-rule shadow-xl rounded-t-xl md:rounded-xl overflow-hidden"
          style={{ maxHeight: "85vh" }}
        >
          {/* Header */}
          <div className="bg-browndeep text-paper px-4 py-3 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <SparkleIcon />
              <div className="font-display text-base font-semibold leading-none">Ask Claude</div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearChat}
                  className="px-2 py-1 rounded text-[11px] font-sans text-paper/80 border border-paper/30 hover:bg-paper/10"
                  aria-label="Clear conversation"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 py-1 rounded text-[11px] font-sans text-paper/80 border border-paper/30 hover:bg-paper/10"
                aria-label="Close chat"
              >
                Close
              </button>
            </div>
          </div>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4 space-y-3 bg-paper2/40"
          >
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="font-sans text-sm text-inksoft">
                  Ask anything about the data currently loaded on the dashboard. Claude can compare
                  reps, summarize trends, look up specific states or SKUs, and explain what the
                  numbers mean.
                </p>
                <div className="space-y-1.5">
                  <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
                    Try
                  </div>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="block w-full text-left px-3 py-2 rounded-md font-sans text-xs text-inksoft border border-rule bg-card hover:bg-paper2 hover:border-tan transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))}
            {loading && <Bubble role="assistant" content="…" pulsing />}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-rule bg-card px-3 py-3 md:px-4 md:py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about KPIs, reps, trends…"
                rows={2}
                className="flex-1 bg-paper2 text-ink border border-rule rounded-md px-3 py-2 font-sans text-sm resize-none focus:outline-none focus:border-tan"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="shrink-0 min-h-touch px-4 rounded-md font-sans text-sm font-semibold bg-brown text-ink hover:bg-browndeep transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
            <p className="font-sans text-[10px] text-muted mt-1.5 leading-snug">
              Claude sees the dashboard data for the period currently loaded. Refining the date
              filter narrows what it can reference.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ role, content, pulsing }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 font-sans text-[13px] leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-brown text-ink"
            : "bg-card text-ink border border-rule"
        } ${pulsing ? "animate-pulse" : ""}`}
      >
        {content}
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 14l.9 2.4L22.3 17l-2.4.9L19 20l-.9-2.1L15.7 17l2.4-.6L19 14z"
        fill="currentColor"
      />
    </svg>
  );
}
