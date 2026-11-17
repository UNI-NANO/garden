import { describe, expect, it } from "vitest";
import {
  act,
  GatheringError,
  planField,
  replayGathering,
  startGathering,
  type Field,
} from "../src/rules/gathering";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const { rules } = defs.gathering;
const spot = defs.gathering.spots[0]!;

/** 약초 하나와 독초 하나가 다 있는 비탈 */
function fieldWithBoth(
  season: "봄" | "여름" | "가을" | "겨울" = "여름",
): Field {
  for (let s = 0; ; s++) {
    const f = planField(`g${s}`, spot, season, rules);
    if (f.plants.some((p) => p.poison) && f.plants.some((p) => !p.poison))
      return f;
  }
}

describe("채집", () => {
  it("같은 씨앗·계절이면 같은 비탈, 풀 수·자리·계절이 맞다", () => {
    expect(planField("s1", spot, "봄", rules)).toEqual(
      planField("s1", spot, "봄", rules),
    );
    for (let s = 0; s < 300; s++) {
      const f = planField(`s${s}`, spot, "겨울", rules);
      expect(f.plants.length).toBeGreaterThanOrEqual(rules.plants.min);
      expect(f.plants.length).toBeLessThanOrEqual(rules.plants.max);
      for (const p of f.plants) {
        expect(p.herb.seasons).toContain("겨울");
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.poison ? p.quantity : p.quantity >= 1).toBe(
          p.poison ? 0 : true,
        );
        // 독초는 독초의 생김새, 약초는 약초의 생김새
        expect(p.tells).toEqual(
          p.poison ? p.herb.lookalike?.tells : p.herb.tells,
        );
      }
      expect(new Set(f.plants.map((p) => `${p.x},${p.y}`)).size).toBe(
        f.plants.length,
      );
    }
  });

  it("독초는 잎 뒤가 약초와 늘 다르다 (잎 뒤 보기로 가려낼 수 있다)", () => {
    for (const herb of spot.herbs)
      if (herb.lookalike)
        expect(herb.lookalike.tells.back).not.toBe(herb.tells.back);
  });

  it("품질: 빨리 뜯기 하, 잎 뒤 보고 빨리 중, 조심히 상, 잎 뒤 보고 조심히 최상. 피로 단계만큼 내려간다", () => {
    const field = fieldWithBoth();
    const herbs = field.plants.filter((p) => !p.poison);
    const one = herbs[0]!.index;
    const quality = (
      actions: Parameters<typeof replayGathering>[1],
      steps = 0,
    ) => replayGathering(field, actions, rules, steps).gains.at(-1)?.quality;
    expect(quality([{ plant: one, kind: "빨리 뜯기" }])).toBe(
      rules.quality.quick,
    );
    expect(
      quality([
        { plant: one, kind: "잎 뒤 보기" },
        { plant: one, kind: "빨리 뜯기" },
      ]),
    ).toBe(rules.quality.quickChecked);
    expect(quality([{ plant: one, kind: "조심히 캐기" }])).toBe(
      rules.quality.careful,
    );
    expect(
      quality([
        { plant: one, kind: "잎 뒤 보기" },
        { plant: one, kind: "조심히 캐기" },
      ]),
    ).toBe("최상");
    expect(
      quality(
        [
          { plant: one, kind: "잎 뒤 보기" },
          { plant: one, kind: "조심히 캐기" },
        ],
        2,
      ),
    ).toBe("중");
    expect(
      quality(
        [
          { plant: one, kind: "잎 뒤 보기" },
          { plant: one, kind: "조심히 캐기" },
        ],
        9,
      ),
    ).toBe("하");
    const got = replayGathering(
      field,
      [{ plant: one, kind: "조심히 캐기" }],
      rules,
    ).gains[0]!;
    expect(got).toEqual({
      item: herbs[0]!.herb.item,
      quantity: herbs[0]!.quantity,
      quality: "상",
      plant: one,
    });
  });

  it("독초를 캐면 헛수고, 시간만 든다", () => {
    const field = fieldWithBoth();
    const poison = field.plants.find((p) => p.poison)!.index;
    const state = replayGathering(
      field,
      [{ plant: poison, kind: "조심히 캐기" }],
      rules,
    );
    expect(state.gains).toEqual([]);
    expect(state.wasted).toEqual([poison]);
    expect(state.timeLeft).toBe(rules.time - rules.cost.careful);
  });

  it("시간: 행동마다 줄고, 모자라면 못 하고, 할 수 있는 게 없으면 비가 온다. 같은 풀은 두 번 못 캔다", () => {
    const field = fieldWithBoth();
    const [a, b] = field.plants;
    let state = act(
      startGathering(rules),
      field,
      { plant: a!.index, kind: "빨리 뜯기" },
      rules,
    );
    expect(() =>
      act(state, field, { plant: a!.index, kind: "빨리 뜯기" }, rules),
    ).toThrow("이미 캔");
    state = act(state, field, { plant: b!.index, kind: "잎 뒤 보기" }, rules);
    expect(() =>
      act(state, field, { plant: b!.index, kind: "잎 뒤 보기" }, rules),
    ).toThrow("이미 잎 뒤");
    expect(state.timeLeft).toBe(
      rules.time - rules.cost.quick - rules.cost.back,
    );
    const low = { ...state, timeLeft: rules.cost.careful - 1 };
    expect(() =>
      act(low, field, { plant: b!.index, kind: "조심히 캐기" }, rules),
    ).toThrow(GatheringError);
    // 빨리 뜯기만 계속하면 시간이 다 떨어져 비가 온다 (풀이 먼저 떨어지면 그것도 끝)
    let s = startGathering(rules);
    for (const p of field.plants)
      if (!s.rained)
        s = act(s, field, { plant: p.index, kind: "빨리 뜯기" }, rules);
    expect(s.rained).toBe(true);
    expect(() =>
      act(s, field, { plant: 0, kind: "빨리 뜯기" }, rules),
    ).toThrow();
  });
});
