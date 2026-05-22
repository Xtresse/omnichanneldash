"use client";

// Scenario-tab chat. Shares Thread.jsx with /ask so tool-call cards
// render identically, but talks to /api/scenario and posts the current
// assumption-panel state on every turn so the model knows what the
// user is looking at.

import { useEffect, useRef, useState } from "react";
import Thread from "../ask/Thread.jsx";

const SUGGESTIONS = [
  "Where are we projected to land this month given the current panel?",
  "If B2B holds the current run rate and DTC grows 15% over the rest of the quarter, what's the EOQ landing?",
  "Which reps are pacing for the most new accounts by EOM? Who's behind?",
  "What's the trailing 90-day retention rate by channel and how does that affect our DTC projection?",
  "How much more do we need per day to close the gap to last year's full-year revenue?",
];

export default function ScenarioChat({ panelState }) {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [storeMode, setStoreMode] = useState("memory");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(panelState);

  useEffect(() => {
    panelRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    refreshConversations();
  }, []);

  async function refreshConversations() {
    try {
      const res = await fetch("/api/scenario/conversations", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) {
        setConversations(json.items || []);
        if (json.mode) setStoreMode(json.mode);
      }
    } catch (e) {
      // non-fatal
    }
  }

  async function loadConversation(id) {
    setError(null);
    try {
      const res = await fetch(`/api/scenario/conversations/${id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json?.ok) {
        setConversation(json.conversation);
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
    if (inputRef.current) inputRef.current.focus();
  }

  async function deleteConversation(id, ev) {
    ev?.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/scenario/conversations/${id}`, { method: "DELETE" });
      if (conversation?.id === id) setConversation(null);
      await refreshConversations();
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
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          conversationId: conversation?.id || null,
          panelState: panelRef.current,
        }),
      });
      const json = await res.json();
      if (!json?.ok) {
        setError(json?.error || `${res.status} ${res.statusText}`);
      }
      const id = json?.conversationId;
      if (id) {
        const fresh = await fetch(`/api/scenario/conversations/${id}`, {
          cache: "no-store",
        });
        const conv = await fresh.json();
        if (conv?.ok) setConversation(conv.conversation);
      }
      await refreshConversations();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

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
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2 bg-paper2/50 shrink-0">
        <button
          type="button"
          onClick={newConversation}
          className="px-2.5 py-1 rounded-md bg-brown text-paper font-sans text-[12px] font-semibold hover:bg-browndeep transition"
        >
          + New
        </button>
        <select
          value={conversation?.id || ""}
          onChange={(e) => {
            if (!e.target.value) newConversation();
            else loadConversation(e.target.value);
          }}
          className="flex-1 min-w-0 bg-paper2 border border-rule rounded-md px-2 py-1 font-sans text-[12px] text-inksoft focus:outline-none focus:border-tan"
          style={{ fontSize: 16 }}
        >
          <option value="">— Conversations ({conversations.length})</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        {conversation?.id && (
          <button
            type="button"
            onClick={(ev) => deleteConversation(conversation.id, ev)}
            className="px-2 py-1 rounded text-[11px] font-sans text-muted hover:text-brown border border-rule"
            aria-label="Delete current conversation"
            title="Delete this conversation"
          >
            ×
          </button>
        )}
        <span className="font-sans text-[10px] text-muted hidden md:inline">
          store: {storeMode}
        </span>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {messages.length === 0 ? (
          <div className="px-3 md:px-6 py-5 space-y-4">
            <div>
              <h3 className="font-display text-lg md:text-xl font-semibold text-ink leading-tight mb-1.5">
                Plan with the assistant.
              </h3>
              <p className="font-sans text-[13px] text-inksoft leading-relaxed">
                It knows your current panel (horizon + assumptions) and can call
                the same projection math the cards run. Ask about pacing, run
                what-ifs, drill into specific reps, or stress-test retention.
              </p>
            </div>
            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted mb-1.5">
                Try
              </div>
              <ul className="space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => send(s)}
                      className="w-full text-left px-3 py-2 rounded-md font-sans text-[12px] text-inksoft border border-rule bg-card hover:bg-paper2 hover:border-tan transition"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <>
            <Thread messages={messages} />
            {loading && (
              <div className="px-3 md:px-6 py-3 text-[12px] text-muted font-sans animate-pulse">
                Thinking…
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-rule bg-card p-3 md:p-4 shrink-0">
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
            placeholder="Ask about pacing, run a what-if, project a rep…"
            rows={2}
            disabled={loading}
            className="flex-1 bg-paper2 text-ink border border-rule rounded-md px-3 py-2 font-sans text-sm resize-none focus:outline-none focus:border-tan"
            style={{ fontSize: 16 }}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="shrink-0 min-h-touch px-4 rounded-md font-sans text-sm font-semibold bg-brown text-paper hover:bg-browndeep transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <p className="font-sans text-[10px] text-muted mt-1.5 leading-snug">
          Enter to send · Shift+Enter for newline · Claude sees your current
          assumptions and calls the projection rails for grounded answers.
        </p>
      </div>
    </div>
  );
}
