import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client";

/** Locate the SQL files whether running from source or from a bundled server. */
function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    (() => {
      try {
        return join(dirname(fileURLToPath(import.meta.url)), "migrations");
      } catch {
        return undefined;
      }
    })(),
    resolve(process.cwd(), "packages/core/src/db/migrations"),
    resolve(process.cwd(), "../../packages/core/src/db/migrations"),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(join(p, "0001_init.sql")));
  if (!found) throw new Error(`Migrations directory not found (looked in: ${candidates.join(", ")})`);
  return found;
}

/**
 * Apply numbered SQL migrations in order, each in its own transaction.
 * An advisory lock keeps concurrent boots (web + voice) from racing.
 */
export async function migrate(sql: Sql, log: (m: string) => void = () => {}) {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  // Session-level advisory lock must be taken and released on the same connection.
  const conn = await sql.reserve();
  await conn`select pg_advisory_lock(727395)`;
  try {
    const dir = migrationsDir();
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = new Set(
      (await conn<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(dir, file), "utf8");
      await conn.unsafe(`begin`);
      try {
        await conn.unsafe(body);
        await conn`insert into schema_migrations (name) values (${file})`;
        await conn.unsafe(`commit`);
      } catch (e) {
        await conn.unsafe(`rollback`);
        throw e;
      }
      log(`applied ${file}`);
    }
  } finally {
    await conn`select pg_advisory_unlock(727395)`;
    conn.release();
  }
}
