import { describe, expect, it } from "vitest";
import rawTable from "../data/defs/skill-table.json";
import { computeSkillNumbers, SkillTableError, type SkillNumbersInput } from "../src/rules/skill-table";
import { SkillTableSchema } from "../src/schema/defs/skill-table";

const table = SkillTableSchema.parse(rawTable);
const base: SkillNumbersInput = { tier: "1단계", potency: "보통", hits: 1, range: "단일", effectWeights: [] };
const calc = (over: Partial<SkillNumbersInput>) => computeSkillNumbers(table, { ...base, ...over });

describe("기준표 파일", () => {
  it("스키마를 통과한다", () => {
    expect(SkillTableSchema.safeParse(rawTable).success).toBe(true);
  });
  it("빠진 단계나 모르는 칸은 거부한다", () => {
    const { 궁극기: _drop, ...tiers } = rawTable.tiers;
    void _drop;
    expect(SkillTableSchema.safeParse({ ...rawTable, tiers }).success).toBe(false);
    expect(SkillTableSchema.safeParse({ ...rawTable, extra: 1 }).success).toBe(false);
  });
});

describe("기획서의 예시 그대로", () => {
  it("검풍: 3단계 · 보통 · 1타 · 휩쓸기 → 위력 13.5, 쿨다운 4, 기력 3", () => {
    const r = calc({ tier: "3단계", range: "휩쓸기" });
    expect(r.totalPower).toBeCloseTo(13.5, 10);
    expect(r.cooldown).toBe(4);
    expect(r.energy).toBe(3);
  });
  it("돌진 베기: 2단계 · 강함 · 1타 · 단일 → 위력 14.3, 쿨다운 3, 기력 2", () => {
    const r = calc({ tier: "2단계", potency: "강함" });
    expect(r.totalPower).toBeCloseTo(14.3, 10);
    expect(r.cooldown).toBe(3);
    expect(r.energy).toBe(2);
  });
  it("되받아치기: 2단계 · 보통 · 자세 → 반격 위력 11", () => {
    const r = calc({ tier: "2단계", hits: "자세" });
    expect(r.totalPower).toBeCloseTo(11, 10);
    expect(r.hitCount).toBe(1);
  });
  it("기본 공격: 위력 6, 쿨다운 0, 기력 0", () => {
    expect(calc({ tier: "기본 공격" })).toMatchObject({ totalPower: 6, cooldown: 0, energy: 0 });
  });
});

describe("항목별 규칙", () => {
  it("타수: 총 위력을 나누고, 2타 ×1.1, 3타 ×1.2", () => {
    const two = calc({ hits: 2 });
    expect(two.totalPower).toBeCloseTo(8 * 1.1, 10);
    expect(two.hitPower).toBeCloseTo((8 * 1.1) / 2, 10);
    const three = calc({ hits: 3 });
    expect(three.totalPower).toBeCloseTo(8 * 1.2, 10);
    expect(three.hitPower * 3).toBeCloseTo(three.totalPower, 10);
  });
  it("위력 성격: 약함 ×0.75, 강함 ×1.3에 쿨다운 +1", () => {
    expect(calc({ potency: "약함" }).totalPower).toBeCloseTo(6, 10);
    expect(calc({ potency: "약함" }).cooldown).toBe(1);
    expect(calc({ potency: "강함" }).cooldown).toBe(2);
  });
  it("범위: 전체 ×0.8에 쿨다운 +2", () => {
    const r = calc({ range: "전체" });
    expect(r.totalPower).toBeCloseTo(6.4, 10);
    expect(r.cooldown).toBe(3);
  });
  it("효과 예산은 더한다: 가벼운 둘 −20%, 가벼운+무거운 −30%", () => {
    expect(calc({ effectWeights: ["가벼운"] }).totalPower).toBeCloseTo(8 * 0.9, 10);
    expect(calc({ effectWeights: ["가벼운", "가벼운"] }).totalPower).toBeCloseTo(8 * 0.8, 10);
    expect(calc({ effectWeights: ["가벼운", "무거운"] }).totalPower).toBeCloseTo(8 * 0.7, 10);
  });
  it("효과가 아무리 많아도 위력은 0 아래로 가지 않는다", () => {
    const many = Array.from({ length: 8 }, () => "무거운" as const);
    expect(calc({ effectWeights: many }).totalPower).toBe(0);
  });
  it("개성 보정은 위력에 곱한다", () => {
    expect(calc({ tier: "궁극기", personality: 1.2 }).totalPower).toBeCloseTo(24 * 1.2, 10);
  });
  it("배율은 서로 곱한다", () => {
    const r = calc({ tier: "3단계", potency: "강함", hits: 2, range: "휩쓸기", effectWeights: ["가벼운"] });
    expect(r.totalPower).toBeCloseTo(15 * 1.3 * 1.1 * 0.9 * 0.9, 10);
    expect(r.cooldown).toBe(3 + 1 + 1);
  });
});

describe("경계", () => {
  it("기준표에 없는 타수는 거부한다", () => {
    expect(() => calc({ hits: 4 })).toThrow(SkillTableError);
    expect(() => calc({ hits: 0 })).toThrow(SkillTableError);
    expect(() => calc({ hits: 1.5 })).toThrow(SkillTableError);
  });
  it("0 이하의 개성 보정은 거부한다", () => {
    expect(() => calc({ personality: 0 })).toThrow(SkillTableError);
    expect(() => calc({ personality: -1 })).toThrow(SkillTableError);
  });
  it("기준값을 바꾸면 결과가 따라 바뀐다 (코드에 숫자가 없다)", () => {
    const changed = SkillTableSchema.parse({
      ...rawTable,
      tiers: { ...rawTable.tiers, "3단계": { power: 20, cooldown: 4, energy: 4 } },
      range: { ...rawTable.range, 휩쓸기: { multiplier: 0.5, cooldownAdd: 0 } },
    });
    const r = computeSkillNumbers(changed, { ...base, tier: "3단계", range: "휩쓸기" });
    expect(r).toMatchObject({ totalPower: 10, cooldown: 4, energy: 4 });
  });
  it("같은 입력이면 같은 결과", () => {
    expect(calc({ hits: 3, effectWeights: ["가벼운"] })).toEqual(calc({ hits: 3, effectWeights: ["가벼운"] }));
  });
});
