"use client";

import { useState, useRef, useEffect } from "react";

const SUGGESTIONS = [
  "Which rep had the biggest growth this period?",
  "How does B2B compare to last month?",
  "What product family is trending up?",
  "Top 3 states by net sales right now?",
  "Summarize the period in 3 bullet points.",
  "Which discount codes drove the most revenue?",
];

/**
 * Floating chat panel that posts dashboard data + the user's question to
 * /api/chat. The API route forwards to Anthropic and returns the reply.
 *
 * The panel can also be opened by any component dispatching a
 * `xtresse:open-chat` window event with an optional `detail.prompt`. That
 * decouples the masthead's "Ask Claude" launcher from this component's
 * state — anything in the tree can summon the chat without prop drilling.
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

  // Listen for the global "open chat" event so the masthead button (or
  // anything else) can summon the panel without prop drilling. If a
  // suggested prompt is included it gets preloaded into the input.
  useEffect(() => {
    function handler(e) {
      setOpen(true);
      const prompt = e?.detail?.prompt;
      if (typeof prompt === "string" && prompt.trim()) setInput(prompt);
    }
    window.addEventListener("xtresse:open-chat", handler);
    return () => window.removeEventListener("xtresse:open-chat", handler);
  }, []);

  // Esc to close — small accessibility win that enterprise panels expect.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
      {/* Floating launcher — keeps the bottom-right entry for users
          who scroll past the masthead. Refined to use the elevation
          and motion tokens. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-40 bg-brown text-paper rounded-full shadow-card-hover hover:bg-browndeep transition-all duration-mid ease-out hover:scale-[1.03] active:scale-100 flex items-center gap-2 px-4 py-3 font-sans text-sm font-semibold"
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
          className="fixed inset-x-0 bottom-0 z-40 md:inset-auto md:bottom-6 md:right-6 md:w-[440px] md:max-h-[680px] flex flex-col bg-card border border-rule shadow-card-hover rounded-t-xl md:rounded-xl overflow-hidden"
          style={{ maxHeight: "85vh" }}
        >
          {/* Header */}
          <div className="section-banner px-4 py-3 flex items-center justify-between gap-3 shrink-0 rounded-none">
            <div className="flex items-center gap-2 min-w-0">
              <SparkleIcon />
              <div className="min-w-0">
                <div className="font-display text-base font-semibold leading-none">Ask Claude</div>
                <div className="font-sans text-[10px] uppercase tracking-chip opacity-80 mt-0.5">
                  Scoped to current period
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearChat}
                  className="px-2 py-1 rounded text-[11px] font-sans text-paper/85 border border-paper/30 hover:bg-paper/10 transition-colors duration-fast"
                  aria-label="Clear conversation"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 py-1 rounded text-[11px] font-sans text-paper/85 border border-paper/30 hover:bg-paper/10 transition-colors duration-fast"
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
                <p className="font-sans text-sm text-inksoft leading-relaxed">
                  Ask anything about the data currently loaded. Claude can compare reps, summarize
                  trends, look up specific states or SKUs, and explain what the numbers mean.
                </p>
                <div className="space-y-1.5">
                  <div className="eyebrow text-muted">Try one of these</div>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="block w-full text-left px-3 py-2 rounded-md font-sans text-xs text-inksoft border border-rule bg-card hover:bg-paper2 hover:border-tan hover:text-ink transition-colors duration-fast ease-out"
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
            {loading && <TypingBubble />}
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
                className="flex-1 bg-paper2 text-ink border border-rule rounded-md px-3 py-2 font-sans text-sm resize-none focus:outline-none focus:border-tan transition-colors duration-fast"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="shrink-0 min-h-touch px-4 rounded-md font-sans text-sm font-semibold bg-brown text-paper hover:bg-browndeep transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
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

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 font-sans text-[13px] leading-relaxed whitespace-pre-wrap shadow-card ${
          isUser
            ? "bg-brown text-paper rounded-br-sm"
            : "bg-card text-ink border border-rule rounded-bl-sm"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

/** Three-dot typing indicator — feels more "live" than a single pulsing ellipsis. */
function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="bg-card text-inksoft border border-rule rounded-xl rounded-bl-sm px-3 py-2.5 shadow-card inline-flex items-center gap-1">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}
function Dot({ delay }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse"
      style={{ animationDelay: delay }}
      aria-hidden="true"
    />
  );
}

function SparkleIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" fill="currentColor" />
      <path d="M19 14l.9 2.4L22.3 17l-2.4.9L19 20l-.9-2.1L15.7 17l2.4-.6L19 14z" fill="currentColor" />
    </svg>
  );
}
