// /api/b2b-goals — B2B MTD status-bar goal storage.
//
// Goals are stored in data/b2b-goals.json keyed by `${product}|${YYYY-MM}`.
// First write for a (product, year-month) creates the entry; subsequent
// writes are allowed (so Sam can correct typos via the small "edit" override
// in the UI) but the UI treats the goal as locked once entered.
//
// Persistence: a plain JSON file checked into the repo. Sam pushes via
// GitHub Desktop, so committed JSON survives deploys. No Vercel KV / Upstash
// is wired up — see package.json (no @vercel/kv / @upstash/redis deps) and
// the absent .env / .env.example confirm this.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Persisting JSON to the filesystem requires the Node.js runtime, not Edge.
export const runtime = "nodejs";
// Don't cache — goals change on user write and we want fresh reads.
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const GOALS_FILE = path.join(DATA_DIR, "b2b-goals.json");

const PRODUCTS = new Set(["Serum", "XVIE", "Gummies"]);
const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

async function readGoals() {
  try {
    const buf = await fs.readFile(GOALS_FILE, "utf8");
    const parsed = JSON.parse(buf);
    return parsed && typeof parsed === "object" && parsed.goals ? parsed : { goals: {} };
  } catch (err) {
    if (err?.code === "ENOENT") return { goals: {} };
    throw err;
  }
}

async function writeGoals(obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(GOALS_FILE, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export async function GET() {
  try {
    const data = await readGoals();
    return NextResponse.json({ ok: true, goals: data.goals || {} });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), goals: {} },
      { status: 200 } // graceful degrade — UI shows blank goals
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { product, yearMonth, goal } = body || {};

    if (!PRODUCTS.has(product)) {
      return NextResponse.json(
        { ok: false, error: `product must be one of Serum / XVIE / Gummies` },
        { status: 400 }
      );
    }
    if (typeof yearMonth !== "string" || !YYYY_MM.test(yearMonth)) {
      return NextResponse.json(
        { ok: false, error: `yearMonth must be YYYY-MM` },
        { status: 400 }
      );
    }
    const goalNum = Number(goal);
    if (!isFinite(goalNum) || goalNum < 0) {
      return NextResponse.json(
        { ok: false, error: `goal must be a non-negative number` },
        { status: 400 }
      );
    }

    const data = await readGoals();
    const key = `${product}|${yearMonth}`;
    data.goals[key] = {
      product,
      yearMonth,
      goal: Math.round(goalNum),
      updatedAt: new Date().toISOString(),
    };
    await writeGoals(data);
    return NextResponse.json({ ok: true, goals: data.goals });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
