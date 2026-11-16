import { describe, expect, it } from "vitest";
import rawEffects from "../data/defs/effects.json";
import {
  addEffect,
  adjustJudgement,
  barModifiers,
  canMove,
  damageTakenBonus,
  decayEffects,
  effectDefs,
  endure,
  extraCooldown,
  judgementMultiplier,
  ongoingDamage,
  powerMultiplier,
  type EffectStacks,
} from "../src/rules/battle/effects";
import { EffectListSchema } from "../src/schema/defs/effect";
import { table } from "./helpers/fake-battle";

const defs = effectDefs(EffectListSchema.parse(rawEffects).effects);
const having = (stacks: EffectStacks) => ({ ...stacks });

describe("효과 붙이기", () => {
  it("중첩으로 쌓이고 최대에서 멈춘다", () => {
    const s: EffectStacks = {};
    expect(addEffect(defs, s, "focus", 2)).toBe(2);
    expect(addEffect(defs, s, "focus", 9)).toBe(3);
    expect(s).toEqual({ focus: 5 });
    expect(addEffect(defs, s, "focus", 1)).toBe(0);
  });
  it("없는 효과와 0 이하는 붙지 않는다", () => {
    const s: EffectStacks = {};
    expect(addEffect(defs, s, "nope", 3)).toBe(0);
    expect(addEffect(defs, s, "bleed", 0)).toBe(0);
    expect(s).toEqual({});
  });
  it("낭독이 있으면 공포·침식·위압이 붙지 않고, 낭독이 붙으면 걸려 있던 것도 사라진다", () => {
    const s = having({ fear: 3, erosion: 1, bleed: 2 });
    addEffect(defs, s, "recite", 2);
    expect(s).toEqual({ bleed: 2, recite: 2 });
    expect(addEffect(defs, s, "fear", 2)).toBe(0);
    expect(addEffect(defs, s, "intimidate", 1)).toBe(0);
    expect(addEffect(defs, s, "bleed", 1)).toBe(1);
  });
  it("늘 면역인 효과(적 카드의 목록)는 붙지 않는다", () => {
    const s: EffectStacks = {};
    expect(addEffect(defs, s, "fear", 2, ["fear"])).toBe(0);
    expect(s).toEqual({});
  });
});

describe("효과가 줄어드는 때", () => {
  it("턴 끝: −1, 절반, 모두, 줄지 않음", () => {
    const s = having({ bleed: 3, poison: 1, burn: 5, ward: 4, erosion: 2, confidence: 3, fragile: 2, focus: 2, resolve: 1 });
    decayEffects(defs, s, "턴 끝");
    expect(s).toEqual({ bleed: 2, burn: 2, erosion: 2, confidence: 3, fragile: 2, focus: 2, resolve: 1 });
  });
  it("맞을 때, 쓸 때", () => {
    const s = having({ fragile: 2, focus: 1, bleed: 3 });
    decayEffects(defs, s, "맞을 때 −1");
    expect(s).toEqual({ fragile: 1, focus: 1, bleed: 3 });
    decayEffects(defs, s, "쓸 때 −1");
    expect(s).toEqual({ fragile: 1, bleed: 3 });
  });
});

describe("효과가 하는 일", () => {
  it("지속 피해: 출혈·독·화상의 중첩을 더한 만큼", () => {
    expect(ongoingDamage(defs, { bleed: 2, poison: 3, burn: 1, fear: 9 })).toBe(6);
    expect(ongoingDamage(defs, {})).toBe(0);
  });
  it("받는 피해: 취약은 더하고 수호는 뺀다", () => {
    expect(damageTakenBonus(defs, { fragile: 3 })).toBe(3);
    expect(damageTakenBonus(defs, { ward: 2 })).toBe(-2);
    expect(damageTakenBonus(defs, { fragile: 3, ward: 5 })).toBe(-2);
  });
  it("주는 위력: 사기는 누구에게나, 공포와 위압은 적이 칠 때만", () => {
    expect(powerMultiplier(defs, { morale: 2 }, {}, false)).toBeCloseTo(1.1, 10);
    expect(powerMultiplier(defs, { fear: 2 }, {}, false)).toBe(1);
    expect(powerMultiplier(defs, { fear: 2 }, {}, true)).toBeCloseTo(0.9, 10);
    expect(powerMultiplier(defs, {}, { intimidate: 4 }, true)).toBeCloseTo(0.8, 10);
    expect(powerMultiplier(defs, {}, { intimidate: 4 }, false)).toBe(1);
    expect(powerMultiplier(defs, { fear: 20 }, { intimidate: 10 }, true)).toBe(0);
  });
  it("침식: 완벽으로 쳐도 좋음", () => {
    expect(adjustJudgement(defs, { erosion: 1 }, "완벽")).toBe("좋음");
    expect(adjustJudgement(defs, { erosion: 1 }, "보통")).toBe("보통");
    expect(adjustJudgement(defs, {}, "완벽")).toBe("완벽");
  });
  it("자신감: 보통 판정의 배율이 중첩당 0.05씩, 1.0까지", () => {
    expect(judgementMultiplier(defs, table, {}, "보통")).toBe(0.7);
    expect(judgementMultiplier(defs, table, { confidence: 2 }, "보통")).toBeCloseTo(0.8, 10);
    expect(judgementMultiplier(defs, table, { confidence: 6 }, "보통")).toBe(1);
    expect(judgementMultiplier(defs, table, { confidence: 6 }, "좋음")).toBe(1);
    expect(judgementMultiplier(defs, table, { confidence: 6 }, "빗나감")).toBe(0);
    expect(judgementMultiplier(defs, table, { confidence: 6 }, "완벽")).toBe(1.3);
  });
  it("판정 바: 집중은 넓히고, 상대의 위압은 좁히고, 공포는 흔들고, 침식은 완벽을 지운다", () => {
    expect(barModifiers(defs, { focus: 2 }, {})).toEqual({ goodWidth: 4, shake: 0, noPerfect: false });
    expect(barModifiers(defs, { focus: 1, fear: 3, erosion: 1 }, { intimidate: 2 })).toEqual({ goodWidth: -2, shake: 3, noPerfect: true });
  });
  it("속박: 움직이지 못한다", () => {
    expect(canMove(defs, { bind: 1 })).toBe(false);
    expect(canMove(defs, { bleed: 3 })).toBe(true);
  });
  it("신속: 쿨다운이 1 더 줄어든다 (중첩이 많아도 1)", () => {
    expect(extraCooldown(defs, { haste: 3 })).toBe(1);
    expect(extraCooldown(defs, {})).toBe(0);
  });
  it("결의: 한 번 버티고 하나 줄어든다", () => {
    const s = having({ resolve: 2 });
    expect(endure(defs, s)).toBe(1);
    expect(s).toEqual({ resolve: 1 });
    expect(endure(defs, s)).toBe(1);
    expect(s).toEqual({});
    expect(endure(defs, s)).toBeUndefined();
  });
});
