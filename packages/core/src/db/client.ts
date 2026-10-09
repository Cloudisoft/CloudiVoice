import postgres from "postgres";
import { env } from "../env";

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

const globalForDb = globalThis as unknown as { __cvSql?: Sql };

/** Shared connection pool (survives Next.js dev hot reloads). */
export function db(): Sql {
  if (!globalForDb.__cvSql) {
    globalForDb.__cvSql = postgres(env.databaseUrl, {
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return globalForDb.__cvSql;
}

/** Replace the pool (tests point this at a throwaway database). */
export function setDb(sql: Sql | undefined) {
  globalForDb.__cvSql = sql;
}

export const APP_ROLE = "cloudivoice_app";

/**
 * Run `fn` inside a transaction that is confined to one organization by
 * Postgres row-level security. The role switch means even a buggy query
 * without an org filter cannot read another tenant's rows.
 */
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error("Invalid organization id");
  return db().begin(async (tx) => {
    await tx.unsafe(`set local role ${APP_ROLE}`);
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** System-level work (auth, workers, webhooks) that spans tenants. */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(fn) as Promise<T>;
}
