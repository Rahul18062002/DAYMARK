// Production start (Embarko runs `npm start`): migrate the SQLite database safely, then serve.
// One process: the Next.js standalone server is imported here instead of being spawned.
import path from "node:path";
import { safeMigrate } from "./safe-migrate.mjs";

const root = path.resolve(import.meta.dirname, "..");
const result = safeMigrate({ cwd: root });
if (!result.ok) {
  console.error("[start] database migration failed; not starting the server (the database was restored if it existed).");
  process.exit(1);
}
process.env.HOSTNAME = "0.0.0.0"; // containers set HOSTNAME to their own id; the platform proxy needs all interfaces
process.env.PORT ||= "3000";
// The platform proxy reuses upstream connections; Node closes idle ones after 5 s by default, which shows up as
// random connection resets (measured: ~0.6% of requests). Keep them open longer than any proxy idle timeout.
process.env.KEEP_ALIVE_TIMEOUT ||= "65000";
await import(path.join(root, ".next/standalone/server.js"));
