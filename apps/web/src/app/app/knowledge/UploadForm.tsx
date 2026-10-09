"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { Icon } from "@/components/ui/Icon";
import { uploadKnowledgeAction, type UploadState } from "./actions";

export function UploadForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [state, action] = useActionState<UploadState, FormData>(uploadKnowledgeAction, {});
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice notice-ok" role="status">{state.ok}</div>}
      {state.error && <div className="notice notice-bad" role="alert">{state.error}</div>}
      <label className="drop">
        <Icon name="upload" size={22} />
        <span>
          <b>Upload PDF, DOCX or TXT</b> — up to 10 files, 10 MB each
        </span>
        <input type="file" name="files" multiple accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" />
      </label>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="k-agent">Available to</label>
          <select id="k-agent" name="agent_id" className="select">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <SubmitButton pendingText="Reading and indexing…">Upload &amp; index</SubmitButton>
      </div>
    </form>
  );
}
