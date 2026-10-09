"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { previewImportAction, runImportAction, type ImportState, type PreviewState } from "../actions";

const FIELDS: { value: string; label: string }[] = [
  { value: "phone", label: "Phone number" },
  { value: "full_name", label: "Full name" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "pincode", label: "PIN code" },
  { value: "language", label: "Language" },
  { value: "custom", label: "Custom field (usable in scripts)" },
  { value: "ignore", label: "Don’t import" },
];

export function ImportWizard({ lists }: { lists: { id: string; name: string }[] }) {
  const [preview, previewAction] = useActionState<PreviewState, FormData>(previewImportAction, {});
  const [result, importAction] = useActionState<ImportState, FormData>(runImportAction, {});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [listMode, setListMode] = useState<"new" | "existing">(lists.length ? "existing" : "new");
  const fileRef = useRef<HTMLInputElement>(null);
  const effective = { ...preview.mapping, ...mapping };
  const hasPhone = Object.values(effective).includes("phone");

  if (result.result) {
    const r = result.result;
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Import complete</h2>
        </div>
        <div className="panel-body">
          <dl className="stats">
            <div className="stat">
              <dt>New leads</dt>
              <dd>{r.imported.toLocaleString("en-IN")}</dd>
            </div>
            <div className="stat">
              <dt>Already existed</dt>
              <dd>{r.updated.toLocaleString("en-IN")}</dd>
            </div>
            <div className="stat">
              <dt>Duplicates in file</dt>
              <dd>{r.duplicatesInFile.toLocaleString("en-IN")}</dd>
            </div>
            <div className="stat">
              <dt>Invalid numbers</dt>
              <dd>{r.invalidPhones.toLocaleString("en-IN")}</dd>
            </div>
            <div className="stat">
              <dt>On DNC list</dt>
              <dd>{r.dncSkipped.toLocaleString("en-IN")}</dd>
            </div>
          </dl>
          {r.invalidSamples.length > 0 && (
            <p className="field-hint" style={{ marginTop: 12 }}>
              Examples of numbers we couldn’t read: <span className="mono">{r.invalidSamples.join(", ")}</span>
            </p>
          )}
          <div className="form-actions">
            <Link href={r.listId ? `/app/leads?list=${r.listId}` : "/app/leads"} className="btn btn-accent btn-sm">
              View leads
            </Link>
            <Link href="/app/campaigns/new" className="btn btn-ghost btn-sm">
              Start a campaign
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>1 · Choose a file</h2>
        </div>
        <form action={previewAction} className="panel-body stack">
          {preview.error && <div className="notice notice-bad">{preview.error}</div>}
          <label className="drop">
            <span>
              <b>CSV or Excel (.xlsx)</b> — first row must contain column names. Up to 50,000 rows.
            </span>
            <input ref={fileRef} type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={() => setMapping({})} />
          </label>
          <div className="form-actions">
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Reading…">
              Read columns
            </SubmitButton>
          </div>
        </form>
      </section>

      {preview.headers && (
        <form
          className="panel"
          action={(fd) => {
            const f = fileRef.current?.files?.[0];
            if (f) fd.set("file", f);
            fd.set("mapping", JSON.stringify(effective));
            return importAction(fd);
          }}
        >
          <div className="panel-head">
            <h2>2 · Map columns</h2>
            <span className="field-hint">{preview.total?.toLocaleString("en-IN")} rows found</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Column in your file</th>
                  <th>Import as</th>
                  <th>Sample values</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((h, i) => (
                  <tr key={h + i}>
                    <td className="strong">{h}</td>
                    <td>
                      <select className="select select-compact" value={effective[h] ?? "custom"} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Import ${h} as`}>
                        {FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preview.rows?.map((r) => r[i]).filter(Boolean).slice(0, 3).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body stack" style={{ borderTop: "1px solid var(--line)" }}>
            {!hasPhone && <div className="notice notice-warn">Choose which column has the phone number.</div>}
            {result.error && <div className="notice notice-bad">{result.error}</div>}
            <div className="form-grid">
              <div className="field">
                <span className="field-label">Add to</span>
                <div className="pill-tabs" role="radiogroup">
                  {lists.length > 0 && (
                    <a role="radio" aria-checked={listMode === "existing"} aria-current={listMode === "existing" ? "page" : undefined} href="#" onClick={(e) => { e.preventDefault(); setListMode("existing"); }}>
                      Existing list
                    </a>
                  )}
                  <a role="radio" aria-checked={listMode === "new"} aria-current={listMode === "new" ? "page" : undefined} href="#" onClick={(e) => { e.preventDefault(); setListMode("new"); }}>
                    New list
                  </a>
                </div>
              </div>
              {listMode === "existing" ? (
                <div className="field">
                  <label htmlFor="i-list">List</label>
                  <select id="i-list" name="list_id" className="select">
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="i-name">New list name</label>
                  <input id="i-name" name="list_name" className="input" defaultValue={`Import ${new Date().toLocaleDateString("en-IN")}`} />
                </div>
              )}
            </div>
            <label className="check">
              <input type="checkbox" name="update" />
              <span>Update details for numbers that already exist (otherwise existing leads are left unchanged).</span>
            </label>
            <div className="form-actions">
              <SubmitButton pendingText="Importing…">Import {preview.total?.toLocaleString("en-IN")} rows</SubmitButton>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
