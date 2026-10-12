"use client";

import { useEffect } from "react";

/** Friendly recovery screen instead of a bare "Application error". */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A tab left open across a deploy asks for files that no longer exist: reload once.
    if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Failed to load chunk/i.test(`${error.name} ${error.message}`)) {
      if (!sessionStorage.getItem("cv-reloaded")) {
        sessionStorage.setItem("cv-reloaded", "1");
        window.location.reload();
        return;
      }
    }
    sessionStorage.removeItem("cv-reloaded");
    console.error(error);
  }, [error]);

  return (
    <div className="error-screen" role="alert">
      <h1>Something went wrong</h1>
      <p>This page hit a problem. Reloading usually fixes it — your data is safe.</p>
      <div className="error-actions">
        <button type="button" className="btn btn-accent" onClick={() => window.location.reload()}>
          Reload page
        </button>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Try again
        </button>
      </div>
      {error.digest && <p className="error-ref mono">Reference: {error.digest}</p>}
    </div>
  );
}
