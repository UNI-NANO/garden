import { describe, expect, it } from "vitest";
import {
  act,
  approachAlert,
  BAR_LENGTH,
  barWidths,
  huntGains,
  isDownwind,
  planHunt,
  replayHunt,
  startHunt,
  type Hunt,
  type HuntAction,
} from "../src/rules/hunting";
import { barZones } from "../src/rules/battle/judge";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const { rules } = defs.hunting;
const ground = defs.hunting.grounds[0]!;

/** 맞는 길만 조용히, 바람을 등지지 않는 쪽이 맞으면 */
const rightPath = (hunt: Hunt, fork: number) =>
  hunt.forks[fork]!.paths.findIndex((p) => p.right);
const follow = (hunt: Hunt): HuntAction[] =>
  hunt.forks.map((_, f) => ({
    kind: "길",
    path: rightPath(hunt, f),
    pace: "조용히",
  }));
const center = BAR_LENGTH / 2;
/** 바람을 한 번도 등지지 않는 사냥 */
function calmHunt(prey: string): Hunt {
  for (let s = 0; ; s++) {
    const h = planHunt(`h${s}`, ground, "여름", rules);
    if (
      h.prey.id === prey &&
      h.forks.every((f) => !isDownwind(f, f.paths.find((p) => p.right)!.dir))
    )
      return h;
  }
}

describe("사냥", () => {
  it("같은 씨앗·계절이면 같은 흔적. 맞는 길은 그 짐승의 흔적, 틀린 길은 다른 짐승의 흔적. 계절에 맞는 짐승만", () => {
    expect(planHunt("s1", ground, "가을", rules)).toEqual(
      planHunt("s1", ground, "가을", rules),
    );
    for (let s = 0; s < 300; s++) {
      const h = planHunt(`s${s}`, ground, "겨울", rules);
      expect(h.prey.seasons).toContain("겨울");
      expect(h.forks).toHaveLength(rules.forks);
      for (const fork of h.forks) {
        expect(fork.paths.filter((p) => p.right)).toHaveLength(1);
        expect(new Set(fork.paths.map((p) => p.dir)).size).toBe(
          fork.paths.length,
        );
        for (const p of fork.paths)
          expect(h.prey.tracks.includes(p.track)).toBe(p.right);
      }
    }
  });

  it("맞는 길을 조용히 따라가면 짐승이 보인다. 경계는 조용히 걸음만큼", () => {
    const h = calmHunt("grass-hare");
    const state = replayHunt(h, follow(h), rules);
    expect(state.phase).toBe("조준");
    expect(state.alert).toBe(rules.forks * rules.alert.quiet);
    expect(state.halfSteps).toBe(rules.steps * 2 - rules.forks * 2);
    expect(state.distance).toBe(rules.distance.start);
  });

  it("틀린 길·빠르게·바람을 등지면 경계가 더 오르고, 다 차면 달아난다. 걸음이 떨어지면 놓친다", () => {
    const h = calmHunt("antelope");
    const wrong = h.forks[0]!.paths.findIndex((p) => !p.right);
    const s1 = act(
      startHunt(rules),
      h,
      { kind: "길", path: wrong, pace: "빠르게" },
      rules,
    );
    const downwind = isDownwind(h.forks[0]!, h.forks[0]!.paths[wrong]!.dir)
      ? rules.alert.downwind
      : 0;
    expect(s1.alert).toBe(rules.alert.fast + rules.alert.wrong + downwind);
    expect(s1.fork).toBe(0);
    expect(() =>
      act(s1, h, { kind: "길", path: wrong, pace: "조용히" }, rules),
    ).toThrow("이미 틀린 길");
    // 경계가 다 차면 달아남
    const nervous = act(
      { ...startHunt(rules), alert: 95 },
      h,
      { kind: "길", path: rightPath(h, 0), pace: "빠르게" },
      rules,
    );
    expect(nervous.outcome).toBe("달아남");
    expect(nervous.alert).toBe(100);
    // 걸음이 떨어지면 놓침
    const tired = act(
      { ...startHunt(rules), halfSteps: 2 },
      h,
      { kind: "길", path: wrong, pace: "조용히" },
      rules,
    );
    expect(tired.outcome).toBe("놓침");
  });

  it("다가가면 거리가 줄고 경계가 오른다(예민할수록). 가까울수록 판정 칸이 넓다", () => {
    const h = calmHunt("antelope");
    let state = replayHunt(h, follow(h), rules);
    state = act(state, h, { kind: "다가가기" }, rules);
    expect(state.distance).toBe(rules.distance.start - rules.distance.step);
    expect(state.alert).toBe(
      rules.forks * rules.alert.quiet + approachAlert(h.prey, rules),
    );
    expect(approachAlert(h.prey, rules)).toBeGreaterThan(
      approachAlert(calmHunt("grass-hare").prey, rules),
    );
    const far = barWidths(rules.distance.start, rules);
    const near = barWidths(rules.distance.min, rules);
    expect(far).toEqual(rules.bar.far);
    expect(near).toEqual(rules.bar.near);
    expect(
      barWidths((rules.distance.start + rules.distance.min) / 2, rules).good,
    ).toBeCloseTo((far.good + near.good) / 2);
    expect(() =>
      act(
        { ...state, distance: rules.distance.min },
        h,
        { kind: "다가가기" },
        rules,
      ),
    ).toThrow("더 다가갈 수 없다");
  });

  it("쏘기: 완벽·좋음이면 잡고, 스치면 순한 짐승은 달아나고 위험한 짐승은 달려든다. 빗나가면 달아남", () => {
    const hare = calmHunt("grass-hare");
    const aim = replayHunt(hare, follow(hare), rules);
    const shoot = (h: Hunt, position: number | null) =>
      act(
        replayHunt(h, follow(h), rules),
        h,
        { kind: "쏘기", position },
        rules,
      );
    expect(shoot(hare, center)).toMatchObject({
      outcome: "잡음",
      judgement: "완벽",
    });
    const zones = barZones(barWidths(aim.distance, rules), BAR_LENGTH);
    expect(shoot(hare, zones.normal[0] + 0.1)).toMatchObject({
      outcome: "달아남",
      judgement: "보통",
    });
    expect(shoot(hare, null)).toMatchObject({
      outcome: "달아남",
      judgement: "빗나감",
    });
    const boar = calmHunt("boar");
    expect(shoot(boar, zones.normal[0] + 0.1)).toMatchObject({
      outcome: "달려듦",
    });
  });

  it("얻는 것: 판정·경계·피로·전투에 따라 품질", () => {
    const hare = calmHunt("grass-hare");
    const shot = (position: number, extraAlert = 0) => {
      const aim = replayHunt(hare, follow(hare), rules);
      return act(
        { ...aim, alert: aim.alert + extraAlert },
        hare,
        { kind: "쏘기", position },
        rules,
      );
    };
    const gains = huntGains(shot(center), hare, rules, 0);
    expect(gains.map((g) => g.item)).toEqual(
      hare.prey.drops.map((d) => d.item),
    );
    expect(gains.every((g) => g.quality === "최상")).toBe(true);
    expect(
      huntGains(shot(center, rules.quality.nervousAlert), hare, rules, 0)[0]
        ?.quality,
    ).toBe("상");
    expect(huntGains(shot(center), hare, rules, 2)[0]?.quality).toBe("중");
    const boar = calmHunt("boar");
    const aim = replayHunt(boar, follow(boar), rules);
    const zones = barZones(barWidths(aim.distance, rules), BAR_LENGTH);
    const charged = act(
      aim,
      boar,
      { kind: "쏘기", position: zones.normal[0] + 0.1 },
      rules,
    );
    expect(huntGains(charged, boar, rules, 0, true)[0]?.quality).toBe(
      rules.quality.전투,
    );
    expect(huntGains(charged, boar, rules, 0, false)).toEqual([]);
    expect(huntGains(charged, boar, rules, 0)).toEqual([]);
  });
});
