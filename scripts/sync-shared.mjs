#!/usr/bin/env node
/**
 * Copy the shared components into a site and pin their hashes.
 *
 *   node scripts/sync-shared.mjs                 # write components + lock
 *   node scripts/sync-shared.mjs --check         # verify only, exit 1 on drift
 *
 * The shared source lives in the components repo (../site-components by default,
 * or COMPONENTS_REPO). A site never edits assets/css/components.css or
 * assets/js/components.js directly: this script overwrites them.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.COMPONENTS_REPO || resolve(ROOT, "..", "site-components");
const CHECK = process.argv.includes("--check");

const FILES = [
  { from: "components.css", to: "assets/css/components.css" },
  { from: "components.js", to: "assets/js/components.js" },
  /* Language flag artwork lives here so a wrong flag is fixed once, not thirteen times. */
  { from: "flags.json", to: "scripts/flags.json" },
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

if (!existsSync(SRC)) {
  console.error(`✗ shared components repo not found at ${SRC}`);
  console.error("  clone yourdataweb/site-components next to this repo, or set COMPONENTS_REPO");
  process.exit(1);
}

const version = readFileSync(join(SRC, "VERSION"), "utf8").trim();
const lockPath = join(ROOT, "src/components.lock");
const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;

const entries = {};
let drift = false;

for (const f of FILES) {
  const srcBuf = readFileSync(join(SRC, f.from));
  const destPath = join(ROOT, f.to);
  const destBuf = existsSync(destPath) ? readFileSync(destPath) : null;

  entries[f.to] = { sha256: sha(srcBuf), bytes: srcBuf.length };

  if (!destBuf || sha(destBuf) !== entries[f.to].sha256) {
    drift = true;
    if (CHECK) {
      console.error(`✗ ${f.to} differs from shared v${version}`);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, srcBuf);
      console.log(`✓ ${f.to}  (shared v${version})`);
    }
  }
}

if (CHECK) {
  if (previous && previous.version !== version) {
    console.error(`✗ pinned v${previous.version}, shared is v${version} — run sync-shared.mjs`);
    process.exit(1);
  }
  if (drift) process.exit(1);
  console.log(`✓ shared components match v${version}`);
  process.exit(0);
}

writeFileSync(
  lockPath,
  JSON.stringify({ version, files: entries }, null, 2) + "\n"
);
console.log(`✓ pinned shared components v${version} in src/components.lock`);
