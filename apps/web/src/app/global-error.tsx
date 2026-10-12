"use client";

import { useEffect } from "react";

/** Last-resort boundary (errors in the root layout itself). */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Failed to load chunk/i.test(`${error.name} ${error.message}`)) {
      try {
        if (!sessionStorage.getItem("cv-reloaded")) {
          sessionStorage.setItem("cv-reloaded", "1");
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#05070f", color: "#f3f5fa", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#a7afc2", margin: "0 0 20px" }}>Reloading usually fixes it — your data is safe.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ background: "#ffb020", color: "#111", border: 0, borderRadius: 10, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
