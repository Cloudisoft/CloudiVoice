import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Apply numbered SQL migrations in order, each in its own transaction.
 * An advisory lock keeps concurrent boots (web + voice) from racing.
 */
export async function migrate(sql: Sql, log: (m: string) => void = () => {}) {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`select pg_advisory_lock(727395)`;
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      log(`applied ${file}`);
    }
  } finally {
    await sql`select pg_advisory_unlock(727395)`;
  }
}
