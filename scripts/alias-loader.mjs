// Tiny ESM resolution hook so Node can run the rails modules directly.
// Rewrites `@/foo` → an absolute file URL anchored at the project root.
// Production builds use jsconfig.json which Next handles at compile
// time; for ad-hoc test scripts we have to do it ourselves.

import { fileURLToPath, pathToFileURL } from "url";
import { resolve as resolvePath, dirname } from "path";

const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const abs = resolvePath(PROJECT_ROOT, rel);
    return nextResolve(pathToFileURL(abs).href, context);
  }
  return nextResolve(specifier, context);
}
