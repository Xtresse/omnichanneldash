// Persistence for /ask: conversation threads + a small "learned facts"
// store. Backed by Vercel KV when KV_REST_API_URL + KV_REST_API_TOKEN are
// set; otherwise falls back to a process-local Map so dev-without-KV still
// works (with the obvious caveat that a process restart wipes everything
// — surfaced via store.mode in the API responses).
//
// Key layout:
//   conv:{id}             → JSON conversation
//   conv:index            → JSON array of {id, title, updatedAt} sorted desc
//   facts:learned         → JSON array of {id, content, source, createdAt}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HAS_KV = Boolean(KV_URL && KV_TOKEN);

export const STORE_MODE = HAS_KV ? "kv" : "memory";

// ---- in-memory fallback ----
const mem = new Map();

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV get ${key}: ${res.status}`);
  const body = await res.json();
  return body?.result ?? null;
}

async function kvSet(key, value) {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV set ${key}: ${res.status}`);
}

async function kvDel(key) {
  const res = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV del ${key}: ${res.status}`);
}

async function get(key) {
  if (HAS_KV) {
    const raw = await kvGet(key);
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

async function set(key, value) {
  const json = JSON.stringify(value);
  if (HAS_KV) await kvSet(key, json);
  else mem.set(key, json);
}

async function del(key) {
  if (HAS_KV) await kvDel(key);
  else mem.delete(key);
}

// ============================================================
// Conversations
// ============================================================

const INDEX_KEY = "conv:index";
const FACTS_KEY = "facts:learned";
const MAX_FACTS = 200;
const MAX_CONV_MESSAGES = 200;

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// `kind` partitions conversations into separate UI lanes (default = "ask",
// scenario planning uses "scenario"). The index entries carry .kind so the
// /ask and /scenarios sidebars can each show only their own threads
// without forking the underlying store. Untagged historical entries are
// treated as "ask" for backwards compatibility.
export async function listConversations(kind) {
  const all = (await get(INDEX_KEY)) || [];
  if (!kind) return all;
  return all.filter((c) => (c.kind || "ask") === kind);
}

export async function getConversation(id) {
  return get(`conv:${id}`);
}

export async function createConversation({ title, kind } = {}) {
  const id = newId();
  const now = new Date().toISOString();
  const conv = {
    id,
    title: title || "New conversation",
    kind: kind || "ask",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await set(`conv:${id}`, conv);
  await touchIndex(conv);
  return conv;
}

export async function appendMessage(id, message) {
  const conv = await getConversation(id);
  if (!conv) throw new Error("Conversation not found");
  conv.messages.push(message);
  if (conv.messages.length > MAX_CONV_MESSAGES) {
    conv.messages = conv.messages.slice(-MAX_CONV_MESSAGES);
  }
  conv.updatedAt = new Date().toISOString();
  await set(`conv:${id}`, conv);
  await touchIndex(conv);
  return conv;
}

export async function setConversationTitle(id, title) {
  const conv = await getConversation(id);
  if (!conv) throw new Error("Conversation not found");
  conv.title = String(title).slice(0, 120);
  conv.updatedAt = new Date().toISOString();
  await set(`conv:${id}`, conv);
  await touchIndex(conv);
  return conv;
}

export async function deleteConversation(id) {
  await del(`conv:${id}`);
  const idx = (await get(INDEX_KEY)) || [];
  const next = idx.filter((c) => c.id !== id);
  await set(INDEX_KEY, next);
}

async function touchIndex(conv) {
  const idx = (await get(INDEX_KEY)) || [];
  const without = idx.filter((c) => c.id !== conv.id);
  without.unshift({
    id: conv.id,
    title: conv.title,
    kind: conv.kind || "ask",
    updatedAt: conv.updatedAt,
  });
  await set(INDEX_KEY, without.slice(0, 100));
}

// ============================================================
// Facts ("memory" — short pieces the model has chosen to remember)
// ============================================================

export async function listFacts() {
  return (await get(FACTS_KEY)) || [];
}

export async function addFact({ content, source }) {
  const text = String(content || "").trim();
  if (!text) throw new Error("Empty fact");
  if (text.length > 500) throw new Error("Fact too long (max 500 chars)");
  const facts = (await get(FACTS_KEY)) || [];
  const fact = {
    id: newId(),
    content: text,
    source: source || "user",
    createdAt: new Date().toISOString(),
  };
  facts.unshift(fact);
  await set(FACTS_KEY, facts.slice(0, MAX_FACTS));
  return fact;
}

export async function deleteFact(id) {
  const facts = (await get(FACTS_KEY)) || [];
  const next = facts.filter((f) => f.id !== id);
  await set(FACTS_KEY, next);
}
