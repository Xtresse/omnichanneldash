"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full navigation so the new cookie is sent on the next request.
        window.location.assign(next);
        return;
      }
      const j = await res.json().catch(() => ({}));
      setError(j?.error || "Incorrect password.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-brown font-semibold">
            Xtressé
          </div>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-semibold text-ink leading-tight">
            Omni Channel Dashboard
          </h1>
          <p className="mt-2 font-sans text-xs text-muted">
            Enter the password to continue.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-card border border-rule rounded-xl px-5 py-5 md:px-6 md:py-6 space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-rule bg-paper px-3 py-2.5 font-sans text-sm text-ink min-h-touch focus:outline-none focus:ring-2 focus:ring-brown/40 focus:border-brown"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-xs text-red-900">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-md bg-brown text-ink font-sans text-sm font-semibold uppercase tracking-[0.12em] px-4 py-2.5 min-h-touch disabled:opacity-50 hover:bg-browndeep transition-colors"
          >
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>

        <p className="mt-4 text-center font-sans text-[10px] text-muted">
          Authorized access only · Xtressé internal
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}
