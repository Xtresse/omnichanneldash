"use client";

import { useEffect, useRef, useState } from "react";
import Thread from "./Thread.jsx";

const SUGGESTIONS = [
  "What's MTD net sales and how does it compare to last month?",
  "Top 5 reps by net sales this quarter — and which ones are tracking under their goal?",
  "Show me variance to budget by product family for May.",
  "Why is DTC down vs prior period? Drill into top SKUs.",
  "Who are our top 10 states by net sales YTD?",
];

export default function AskUI() {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null); // full conv
  const [facts, setFacts] = useState([]);
  const [storeMode, setStoreMode] = useState("memory");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Initial load — list of conversations + facts.
  useEffect(() => {
    refreshConversations();
    refreshFacts();
  }, []);

  async function refreshConversations() {
    try {
      const res = await fetch("/api/ask/conversations", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) {
        setConversations(json.items || []);
        if (json.mode) setStoreMode(json.mode);
      }
    } catch (e) {
      // non-fatal
    }
  }

  async function refreshFacts() {
    try {
      const res = await fetch("/api/ask/facts", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) setFacts(json.facts || []);
    } catch (e) {
      // non-fatal
    }
  }

  async function loadConversation(id) {
    setError(null);
    try {
      const res = await fetch(`/api/ask/conversations/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) {
        setConversation(json.conversation);
        setSidebarOpen(false);
      } else {
        setError(json?.error || "Failed to load conversation");
      }
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  function newConversation() {
    setConversation(null);
    setError(null);
    setSidebarOpen(false);
    if (inputRef.current) inputRef.current.focus();
  }

  async function deleteConversation(id, ev) {
    ev?.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/ask/conversations/${id}`, { method: "DELETE" });
      if (conversation?.id === id) setConversation(null);
      await refreshConversations();
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function deleteFact(id) {
    try {
      await fetch(`/api/ask/facts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshFacts();
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function send(question) {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setLoading(true);

    // Optimistic UI: append the user message to the local conversation
    // immediately (server will persist + return the assistant turn).
    const optimisticUser = {
      role: "user",
      content: [{ type: "text", text: q }],
      createdAt: new Date().toISOString(),
    };
    setConversation((c) =>
      c
        ? { ...c, messages: [...(c.messages || []), optimisticUser] }
        : {
            id: null,
            title: q.slice(0, 60),
            messages: [optimisticUser],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
    );

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          conversationId: conversation?.id || null,
        }),
      });
      const json = await res.json();
      if (!json?.ok) {
        setError(json?.error || `${res.status} ${res.statusText}`);
      }
      // Always reload the conversation from the server — it's the
      // source of truth for the assistant turn (text + tool blocks).
      const id = json?.conversationId;
      if (id) {
        const fresh = await fetch(`/api/ask/conversations/${id}`, {
          cache: "no-store",
        });
        const conv = await fresh.json();
        if (conv?.ok) setConversation(conv.conversation);
      }
      await refreshConversations();
      await refreshFacts();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-scroll thread on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages?.length, loading]);

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const messages = conversation?.messages || [];

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-browndeep text-paper border-b border-rule">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="md:hidden px-2 py-1 rounded border border-paper/30 text-[12px]"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <a
            href="/"
            className="font-display text-lg leading-none hover:underline"
          >
            ← Dashboard
          </a>
          <div className="flex-1" />
          <div className="font-display text-lg font-semibold leading-none">
            Ask · Xtressé Omni
          </div>
          <div className="hidden md:block ml-3 text-[10px] text-paper/60">
            store: {storeMode}
          </div>
        </div>
      </header>

      <div className="flex-1 flex max-w-7xl w-full mx-auto min-w-0">
        {/* Sidebar — on mobile takes over the full width when open (main hides);
            on md+ it sits inline as a 72-wide rail. */}
        <aside
          className={`${
            sidebarOpen ? "block" : "hidden"
          } md:block w-full md:w-72 shrink-0 border-r border-rule bg-paper2/40 md:h-[calc(100vh-57px)] md:overflow-y-auto`}
        >
          <div className="p-3 space-y-4">
            <button
              type="button"
              onClick={newConversation}
              className="w-full bg-brown text-ink rounded-md px-3 py-2 font-sans text-sm font-semibold hover:bg-browndeep transition"
            >
              + New conversation
            </button>

            <div>
              <div className="font-sans text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
                Conversations
              </div>
              {conversations.length === 0 ? (
                <div className="text-[12px] text-muted px-1 py-2">
                  No conversations yet.
                </div>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => loadConversation(c.id)}
                        className={`group w-full text-left px-2 py-1.5 rounded-md font-sans text-[12px] flex items-center justify-between gap-2 transition ${
                          conversation?.id === c.id
                            ? "bg-card border border-tan"
                            : "hover:bg-card border border-transparent"
                        }`}
                      >
                        <span className="flex-1 truncate">{c.title}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(ev) => deleteConversation(c.id, ev)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              deleteConversation(c.id, ev);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink text-[14px] leading-none"
                          aria-label="Delete conversation"
                        >
                          ×
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="font-sans text-[10px] uppercase tracking-wider text-muted px-1 mb-1 flex items-center justify-between">
                <span>Learned facts ({facts.length})</span>
              </div>
              {facts.length === 0 ? (
                <div className="text-[12px] text-muted px-1 py-2">
                  Claude will save short context here as you chat.
                </div>
              ) : (
                <ul className="space-y-1">
                  {facts.slice(0, 30).map((f) => (
                    <li
                      key={f.id}
                      className="group flex items-start gap-2 px-2 py-1.5 rounded-md text-[12px] bg-card border border-rule"
                    >
                      <span className="flex-1 leading-snug">{f.content}</span>
                      <button
                        type="button"
                        onClick={() => deleteFact(f.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink text-[14px] leading-none"
                        aria-label="Forget this fact"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* Main — hidden behind sidebar on mobile when the menu is open. */}
        <main className={`${sidebarOpen ? "hidden md:flex" : "flex"} flex-1 flex-col md:h-[calc(100vh-57px)] min-w-0`}>
          {/* Thread */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="max-w-2xl mx-auto px-3 sm:px-4 py-6 sm:py-10 space-y-6">
                <div>
                  <h1 className="font-display text-xl sm:text-2xl font-semibold mb-2 leading-tight">
                    Ask anything about your omnichannel data.
                  </h1>
                  <p className="text-[14px] text-inksoft leading-relaxed">
                    This assistant has live tool access to every rail in the
                    dashboard — KPIs, time series, rep performance, budget vs
                    actual, variance analysis, order-level drilldowns. It will
                    cite numbers from the data, not invent them. Conversations
                    and facts persist between sessions.
                  </p>
                </div>
                <div>
                  <div className="font-sans text-[10px] uppercase tracking-wider text-muted mb-2">
                    Try
                  </div>
                  <ul className="space-y-2">
                    {SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onClick={() => send(s)}
                          className="w-full text-left px-3 py-2 rounded-md font-sans text-[13px] text-ink border border-rule bg-card hover:bg-paper2 hover:border-tan transition"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto">
                <Thread messages={messages} />
                {loading && (
                  <div className="px-3 py-4 md:px-6 text-[12px] text-muted font-sans animate-pulse">
                    Thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-rule bg-card p-3 md:p-4">
            <div className="max-w-3xl mx-auto">
              {error && (
                <div className="mb-2 px-3 py-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded">
                  {error}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask about KPIs, reps, variance, drill into orders…"
                  rows={2}
                  disabled={loading}
                  className="flex-1 bg-paper2 text-ink border border-rule rounded-md px-3 py-2 font-sans text-sm resize-none focus:outline-none focus:border-tan"
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
                Enter to send · Shift+Enter for new line · Claude calls the
                same data rails the dashboard uses.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
