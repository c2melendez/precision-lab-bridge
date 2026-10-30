import { describe, expect, it } from "vitest";
import { validateTrigger } from "./validate";

describe("validateTrigger", () => {
  it("accepts only lite, plus, both", () => {
    expect(validateTrigger({ target_repo: "both", gate: "h1d" }).ok).toBe(true);
    expect(validateTrigger({ target_repo: "other", gate: "h1d" }).ok).toBe(false);
  });
  it("accepts only cumulative, h1d, security", () => {
    expect(validateTrigger({ target_repo: "lite", gate: "security" }).ok).toBe(true);
    expect(validateTrigger({ target_repo: "lite", gate: "deploy" }).ok).toBe(false);
  });
  it("dry_run defaults to true", () => {
    const r = validateTrigger({ target_repo: "lite", gate: "h1d" });
    expect(r.ok && r.params.dry_run).toBe(true);
  });
  it("dry_run=false from URL string", () => {
    const r = validateTrigger({ target_repo: "plus", gate: "h1d", dry_run: "false" });
    expect(r.ok && r.params.dry_run).toBe(false);
  });
  it("rejects non-boolean dry_run", () => {
    expect(validateTrigger({ target_repo: "plus", gate: "h1d", dry_run: "maybe" }).ok).toBe(false);
  });
});