import { USE_CASES } from "@cloudivoice/core/agentConfig";
import { allLanguages, VOICES } from "@cloudivoice/core/languages";

export function agentOptions() {
  return {
    useCases: Object.entries(USE_CASES).map(([value, label]) => ({ value, label })),
    languages: allLanguages().map((l) => ({
      value: l.code,
      label: `${l.name}${l.status === "available" ? "" : " — in validation"}`,
      disabled: l.status !== "available",
    })),
    voices: VOICES.map((v) => ({ value: v.id, label: v.label, gender: v.gender, style: v.style })),
  };
}
