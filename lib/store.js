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

// Use the official @vercel/kv client (same one /api/b2b-goals uses in prod).
// kv.set serializes the value and kv.get deserializes it — ONE consistent
// encoding on both sides. The previous hand-rolled fetch double-encoded the
// body (JSON.stringify of an already-stringified value) yet decoded only once,
// so every cross-instance read came back as a string and never rehydrated.
let _kv = null;
async function kvClient() {
  if (_kv) return _kv;
  const mod = await import("@vercel/kv");
  _kv = mod.kv;
  return _kv;
}

async function get(key) {
  if (HAS_KV) {
    const kv = await kvClient();
    const v = await kv.get(key); // auto-deserialized → object | null
    return v ?? null;
  }
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

async function set(key, value) {
  if (HAS_KV) {
    const kv = await kvClient();
    await kv.set(key, value); // kv serializes the value for us
  } else {
    mem.set(key, JSON.stringify(value));
  }
}

async function del(key) {
  if (HAS_KV) {
    const kv = await kvClient();
    await kv.del(key);
  } else {
    mem.delete(key);
  }
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

export async function listConversations() {
  return (await get(INDEX_KEY)) || [];
}

export async function getConversation(id) {
  return get(`conv:${id}`);
}

export async function createConversation({ title } = {}) {
  const id = newId();
  const now = new Date().toISOString();
  const conv = {
    id,
    title: title || "New conversation",
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
  without.unshift({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
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
