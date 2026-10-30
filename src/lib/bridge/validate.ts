// Pure validation for bridge trigger params (shared by POST /api/runs and GET /api/run).
export const TARGETS = { lite: ["precision-lab-lite"], plus: ["precision-lab-plus"], both: ["precision-lab-lite", "precision-lab-plus"] } as const;
export const GATES = ["cumulative", "h1d", "security"] as const;
export type Target = keyof typeof TARGETS;
export type Gate = (typeof GATES)[number];
export type TriggerParams = { target_repo: Target; gate: Gate; dry_run: boolean };

export const DEDUPE_WINDOW_MINUTES = 5;

export function parseBool(v: unknown): boolean | null {
  if (v === undefined || v === null || v === "") return true; // default true
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
  }
  return null;
}

export function validateTrigger(input: Record<string, unknown>):
  | { ok: true; params: TriggerParams }
  | { ok: false; error: string } {
  const t = typeof input["target_repo"] === "string" ? input["target_repo"].trim().toLowerCase() : "";
  if (!(t in TARGETS)) return { ok: false, error: "target_repo must be lite, plus or both" };
  const g = typeof input["gate"] === "string" ? input["gate"].trim().toLowerCase() : "";
  if (!(GATES as readonly string[]).includes(g)) return { ok: false, error: "gate must be cumulative, h1d or security" };
  if (g === "security" && t !== "lite") {
    return { ok: false, error: "security gate is only available for lite; plus and both are blocked by the current S19 policy" };
  }
  const d = parseBool(input["dry_run"]);
  if (d === null) return { ok: false, error: "dry_run must be true or false" };
  return { ok: true, params: { target_repo: t as Target, gate: g as Gate, dry_run: d } };
}