import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSecurityRules } from "../src/data/security-rules";
import { limits } from "./helpers/fake-character";

describe("보안 규칙 파일", () => {
  it("database.rules.json이 limits.json에서 만든 것과 같다 (다르면 npm run build:rules)", () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "database.rules.json"), "utf8")) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(buildSecurityRules(limits))));
  });
  it("상한 숫자는 limits에서 온다", () => {
    const changed = structuredClone(limits);
    changed.exchange.maxWalletGainPerChange = 777;
    expect(JSON.stringify(buildSecurityRules(changed))).toContain("<= 777");
  });
  it("맨 위는 모두 막혀 있다", () => {
    const { rules } = buildSecurityRules(limits);
    expect([rules[".read"], rules[".write"]]).toEqual([false, false]);
  });
});
