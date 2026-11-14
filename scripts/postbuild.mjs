// `output: "standalone"` leaves static assets and public/ out of the standalone folder. Copy them in.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next/standalone");
if (!fs.existsSync(standalone)) throw new Error("`.next/standalone` not found: run `next build` first (is output: \"standalone\" set?)");
fs.cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("[postbuild] standalone server ready");

// Next copies any .env* it finds into the standalone folder. Production gets its configuration from real
// environment variables only: make sure a local secrets file can never ride along in a build artifact.
for (const f of fs.readdirSync(standalone)) if (f.startsWith(".env")) fs.rmSync(path.join(standalone, f), { force: true });
