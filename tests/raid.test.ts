import { describe, expect, it } from "vitest";
import {
  createBattle,
  playTurn,
  type BattleEvent,
} from "../src/rules/battle/engine";
import { effectDefs } from "../src/rules/battle/effects";
import { simulateBattle } from "../src/rules/battle/simulate";
import {
  contribution,
  gradeOf,
  raidBattle,
  raidGains,
  raidWeek,
} from "../src/rules/raid";
import { idToKey } from "../src/schema/keys";
import { limits, makeCharacter } from "./helpers/fake-character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const sword = defs.trees.find((t) => t.id === "sword")!;
const ctx = {
  rules: defs.battle,
  table: defs.skillTable,
  effects: effectDefs(defs.effects.effects),
};
const battleDefs = {
  skillTable: defs.skillTable,
  effects: defs.effects.effects,
  battle: defs.battle,
  trees: defs.trees,
  enemies: defs.enemies.enemies,
};
const KST = (iso: string) => Date.parse(`${iso}+09:00`);

describe("반복 레이드 — 교대", () => {
  it("기준일(한국 시간 자정)부터 7일마다 다음 보스", () => {
    const order = defs.raids.rotation.order;
    expect(
      raidWeek(KST("2026-11-16T00:00:00"), defs.raids, limits),
    ).toMatchObject({ index: 0, key: "w0" });
    expect(
      raidWeek(KST("2026-11-16T00:00:00"), defs.raids, limits).boss.id,
    ).toBe(order[0]);
    expect(raidWeek(KST("2026-11-22T23:59:59"), defs.raids, limits).index).toBe(
      0,
    );
    expect(
      raidWeek(KST("2026-11-23T00:00:00"), defs.raids, limits).boss.id,
    ).toBe(order[1]);
    expect(raidWeek(KST("2026-11-23T00:00:00"), defs.raids, limits).key).toBe(
      "w1",
    );
    // 차례가 끝나면 처음부터
    const later = raidWeek(
      KST("2026-11-16T12:00:00") + order.length * 7 * 86400000,
      defs.raids,
      limits,
    );
    expect(later.boss.id).toBe(order[0]);
  });

  it("다음 교대 시각은 다음 주 한국 시간 자정", () => {
    expect(
      raidWeek(KST("2026-11-18T15:00:00"), defs.raids, limits).nextChangeAt,
    ).toBe(KST("2026-11-23T00:00:00"));
  });
});

describe("반복 레이드 — 기여 점수", () => {
  const w = defs.raids.contribution;
  it("준 피해·흐트러짐·막아준 피해·받아치기와 피하기 성공을 센다 (적에게 준 것만)", () => {
    const events: BattleEvent[] = [
      {
        turn: 1,
        type: "피해",
        from: "player",
        to: "e0",
        amount: 10,
        stagger: 4,
      },
      { turn: 1, type: "피해", from: "player", to: "e1", amount: 5 },
      { turn: 1, type: "피해", from: "e0", to: "player", amount: 7 },
      {
        turn: 1,
        type: "반응",
        ally: "player",
        enemy: "e0",
        result: "막기 성공",
        prevented: 6,
      },
      {
        turn: 2,
        type: "반응",
        ally: "player",
        enemy: "e0",
        result: "받아치기 성공",
      },
      {
        turn: 2,
        type: "반응",
        ally: "player",
        enemy: "e1",
        result: "피하기 성공",
      },
    ];
    const c = contribution(events, "player", new Set(["e0", "e1"]), w);
    expect(c).toMatchObject({
      damage: 15,
      stagger: 4,
      prevented: 6,
      reactions: 2,
    });
    expect(c.score).toBe(
      Math.round(15 + 4 * w.stagger + 6 * w.prevented + 2 * w.reaction),
    );
  });

  it("실제 전투 기록에도 흐트러짐과 막아준 피해가 남는다", () => {
    const c = makeCharacter();
    const boss = defs.raids.bosses[0]!;
    let state = createBattle(raidBattle(c, boss, battleDefs, "k1"), ctx);
    state = playTurn(
      state,
      {
        actions: [
          {
            unitId: "player",
            type: "기술",
            skillId: sword.basicAttack.id,
            targetId: "e0",
            judgements: ["좋음"],
          },
        ],
        defenses: { "e0>player": "막기 성공", "e1>player": "막기 성공" },
      },
      ctx,
    );
    const hit = state.events.find(
      (e) => e.type === "피해" && e.from === "player",
    );
    expect(hit && hit.type === "피해" && hit.stagger).toBeGreaterThan(0);
    const guard = state.events.find(
      (e) => e.type === "반응" && e.result === "막기 성공",
    );
    if (guard && guard.type === "반응")
      expect(guard.prevented).toBeGreaterThan(0);
  });

  it("등급은 점수의 절대 기준", () => {
    expect(gradeOf(w.grades.금, w.grades)).toBe("금");
    expect(gradeOf(w.grades.은, w.grades)).toBe("은");
    expect(gradeOf(w.grades.동, w.grades)).toBe("동");
    expect(gradeOf(0, w.grades)).toBe("참가");
  });
});

describe("반복 레이드 — 보상과 전투", () => {
  const boss = defs.raids.bosses[0]!;
  it("그 주 처음이면 주간 보상, 아니면 피로 배율을 곱한 일반 보상 (내림, 최소 1)", () => {
    expect(raidGains(boss, true, 0.3)).toHaveLength(boss.weekly.length);
    const full = raidGains(boss, false, 1);
    const tired = raidGains(boss, false, 0.3);
    boss.repeat.forEach((r, i) => {
      expect(full[i]).toMatchObject({ quantity: r.quantity });
      expect(tired[i]).toMatchObject({
        quantity: Math.max(1, Math.floor(r.quantity * 0.3)),
      });
    });
  });

  it("레이드 전투는 이번 주 보스 무리와, 기본기 둘을 갖춘 검사가 넘을 수 있다", () => {
    const c = makeCharacter();
    c.mastery[idToKey("sword")] = {
      value: 50,
      passed60: false,
      passed80: false,
    };
    c.trees[idToKey("sword")] = {
      treeVersion: sword.version,
      picked: { [idToKey("sword.combo")]: true, [idToKey("sword.gale")]: true },
      choices: {},
      spent: { branch: 2, root: 0 },
    };
    c.loadout = { basics: ["sword.combo", "sword.gale"] };
    for (const b of defs.raids.bosses) {
      const setup = raidBattle(c, b, battleDefs, "s");
      expect(setup.kind).toBe("레이드");
      expect(setup.enemies.map((e) => e.def.id)).toEqual(
        b.enemies.map((m) => m.enemy),
      );
      let wins = 0;
      for (let i = 0; i < 60; i++)
        if (
          simulateBattle(raidBattle(c, b, battleDefs, `w${i}`), ctx, "자동")
            .outcome === "승리"
        )
          wins++;
      expect(wins, b.id).toBeGreaterThan(0);
    }
  }, 60_000);
});
