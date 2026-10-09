"use client";

import Link from "next/link";
import { useState } from "react";
import { bulkAction } from "./actions";

interface Row {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  outcome: React.ReactNode;
  attempts: number;
  dnc: boolean;
  created: string;
}

export function LeadTable({
  rows,
  lists,
  filter,
  total,
  canEdit,
  canDelete,
}: {
  rows: Row[];
  lists: { id: string; name: string }[];
  filter: Record<string, string>;
  total: number;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      setAllMatching(false);
      return n;
    });
  const count = allMatching ? total : selected.size;

  return (
    <form action={bulkAction}>
      {Object.entries(filter).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {allMatching ? <input type="hidden" name="all" value="1" /> : [...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
      {count > 0 && canEdit && (
        <div className="toolbar" role="region" aria-label="Bulk actions">
          <b>{count.toLocaleString("en-IN")} selected</b>
          {allOnPage && !allMatching && total > rows.length && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAllMatching(true)}>
              Select all {total.toLocaleString("en-IN")} matching
            </button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <select name="target_list" className="select select-compact" aria-label="Add to list" defaultValue="">
            <option value="" disabled>
              Add to list…
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" name="op" value="list">
            Add
          </button>
          <button className="btn btn-ghost btn-sm" name="op" value="dnc" onClick={(e) => !confirm(`Mark ${count} lead(s) as Do Not Call?`) && e.preventDefault()}>
            Mark DNC
          </button>
          {canDelete && (
            <button className="btn btn-danger btn-sm" name="op" value="delete" onClick={(e) => !confirm(`Delete ${count} lead(s)? This cannot be undone.`) && e.preventDefault()}>
              Delete
            </button>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {canEdit && (
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() => {
                      setAllMatching(false);
                      setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
                    }}
                  />
                </th>
              )}
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>City</th>
              <th>Last outcome</th>
              <th className="num">Attempts</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canEdit && (
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={allMatching || selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td>
                  <Link className="row-link" href={`/app/leads/${r.id}`}>
                    {r.name}
                  </Link>
                  {r.dnc && (
                    <span className="chip chip-bad" style={{ marginLeft: 8 }}>
                      DNC
                    </span>
                  )}
                </td>
                <td className="mono">{r.phone}</td>
                <td>{r.email ?? <span className="muted">—</span>}</td>
                <td>{r.city ?? <span className="muted">—</span>}</td>
                <td>{r.outcome}</td>
                <td className="num">{r.attempts}</td>
                <td className="muted">{r.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
