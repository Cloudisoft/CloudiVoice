import "server-only";
import { db } from "@cloudivoice/core/db/client";
import { migrate } from "@cloudivoice/core/db/migrate";

let ready: Promise<void> | null = null;

/** Apply pending migrations once per server process (numbered SQL files). */
export function ensureMigrated() {
  if (process.env.SKIP_MIGRATIONS === "1") return Promise.resolve();
  ready ??= migrate(db()).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
