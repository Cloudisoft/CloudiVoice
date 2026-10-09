import { db } from "./client";
import { migrate } from "./migrate";

const sql = db();
migrate(sql, (m) => console.log(`[migrate] ${m}`))
  .then(() => console.log("[migrate] up to date"))
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
