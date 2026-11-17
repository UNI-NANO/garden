import { describe, expect, it } from "vitest";
import rawEffects from "../data/defs/effects.json";
import { EffectListSchema } from "../src/schema/defs/effect";
import { describeEffect } from "../src/ui/battle/effect-text";

const effects = EffectListSchema.parse(rawEffects).effects;
const name = (id: string) => effects.find((e) => e.id === id)?.name ?? id;
const text = (id: string) => describeEffect(effects.find((e) => e.id === id)!, name);

describe("효과 설명", () => {
  it("규칙에서 한 줄 설명을 만든다", () => {
    expect(text("bleed")).toBe("턴 끝에 중첩만큼 피해 · 턴 끝 −1 · 최대 10");
    expect(text("ward")).toBe("맞을 때마다 피해 −1 (중첩당) · 턴 끝 모두 · 최대 99");
    expect(text("morale")).toBe("주는 위력 +5% (중첩당) · 턴 끝 −1 · 최대 5");
    expect(text("recite")).toBe("공포·침식·위압에 걸리지 않음 · 턴 끝 −1 · 최대 5");
  });
  it("15종 모두 설명이 있다", () => {
    for (const effect of effects) expect(describeEffect(effect, name)).toMatch(/ · 최대 \d+$/);
  });
});
