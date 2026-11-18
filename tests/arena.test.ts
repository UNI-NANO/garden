import { describe, expect, it } from "vitest";
import {
  duelBattle,
  scoreChange,
  seasonKey,
  seasonLabel,
  shadowEnemy,
  snapshotBuild,
  sourceOf,
} from "../src/rules/arena";
import { allyOfCharacter } from "../src/rules/battle/ally-of";
import { effectDefs } from "../src/rules/battle/effects";
import {
  enemyNumbers,
  masteryMultiplier,
  playerMaxHp,
} from "../src/rules/battle/numbers";
import { simulateBattle } from "../src/rules/battle/simulate";
import { idToKey } from "../src/schema/keys";
import { limits, makeCharacter } from "./helpers/fake-character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const sword = defs.trees.find((t) => t.id === "sword")!;
const allyDefs = {
  skillTable: defs.skillTable,
  effects: defs.effects.effects,
  battle: defs.battle,
  trees: defs.trees,
  arena: defs.arena,
};
const ctx = {
  rules: defs.battle,
  table: defs.skillTable,
  effects: effectDefs(defs.effects.effects),
};

function built(mastery = 50) {
  const c = makeCharacter();
  c.mastery[idToKey("sword")] = {
    value: mastery,
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
  return c;
}

describe("투기장 — 계절과 빌드", () => {
  it("계절 키와 이름", () => {
    expect(seasonKey("514-3")).toBe("514-summer");
    expect(seasonKey("514-0")).toBe("514-spring");
    expect(seasonKey("515-11")).toBe("515-winter");
    expect(seasonLabel("514-summer")).toBe("성력 514 여름");
  });

  it("빌드 스냅숏으로 만든 아군은 캐릭터로 만든 아군과 같다", () => {
    const c = built();
    const build = snapshotBuild(c, defs.trees);
    expect(build).toMatchObject({
      name: c.profile.name,
      treeId: "sword",
      basics: ["sword.combo", "sword.gale"],
      mastery: 50,
    });
    expect(allyOfCharacter(sourceOf(build), allyDefs).ally).toEqual(
      allyOfCharacter(c, allyDefs).ally,
    );
  });
});

describe("투기장 — 그림자 적", () => {
  it("체력은 그 빌드의 최대 체력, 위력은 기본 공격 × 숙련 배율, 행동은 기본 공격과 장착 기술", () => {
    const c = built(40);
    const build = snapshotBuild(c, defs.trees);
    const shadow = shadowEnemy(build, "shadow-x", allyDefs);
    const ally = allyOfCharacter(c, allyDefs).ally;
    const numbers = enemyNumbers(defs.battle, shadow);
    expect(numbers.maxHp).toBe(
      Math.round(
        playerMaxHp(defs.battle, c.abilities.health) *
          defs.arena.shadow.hpMultiplier,
      ),
    );
    expect(numbers.power).toBeCloseTo(
      ally.basicAttack.baseHitPower * masteryMultiplier(defs.battle, 40),
      2,
    );
    expect(shadow.actions.map((a) => a.name)).toEqual([
      ally.basicAttack.name,
      ...ally.skills.map((s) => s.name),
    ]);
    expect(shadow.name).toBe(`${c.profile.name}의 그림자`);
  });

  it("장착이 없으면 기본 공격 하나", () => {
    const shadow = shadowEnemy(
      snapshotBuild(makeCharacter(), defs.trees),
      "s",
      allyDefs,
    );
    expect(shadow.actions).toHaveLength(1);
  });

  it("같은 빌드끼리 붙으면 승패가 갈린다 (한쪽으로 쏠리지 않음)", () => {
    const c = built(50);
    const build = snapshotBuild(c, defs.trees);
    let wins = 0;
    for (let i = 0; i < 100; i++)
      if (
        simulateBattle(
          duelBattle(c, { cid: "o", build }, allyDefs, `d${i}`),
          ctx,
          "자동",
        ).outcome === "승리"
      )
        wins++;
    expect(wins).toBeGreaterThan(15);
    expect(wins).toBeLessThan(95);
  });
});

describe("투기장 — 점수", () => {
  it("같은 점수면 이기면 +k/2, 지면 −k/2", () => {
    expect(scoreChange(1000, 1000, true, 1, limits)).toBe(16);
    expect(scoreChange(1000, 1000, false, 1, limits)).toBe(-16);
  });

  it("강한 상대를 이기면 더 많이, 약한 상대에게 지면 더 많이 잃는다", () => {
    expect(scoreChange(1000, 1400, true, 1, limits)).toBeGreaterThan(
      scoreChange(1000, 1000, true, 1, limits),
    );
    expect(scoreChange(1400, 1000, false, 1, limits)).toBeLessThan(
      scoreChange(1000, 1000, false, 1, limits),
    );
  });

  it("피로 배율은 이길 때만, 최소 1점. 0 아래로는 가지 않는다", () => {
    expect(scoreChange(1000, 1000, true, 0.3, limits)).toBe(4);
    expect(scoreChange(1000, 1000, false, 0.3, limits)).toBe(-16);
    expect(scoreChange(2000, 0, true, 0.3, limits)).toBe(1);
    expect(scoreChange(5, 0, false, 1, limits)).toBe(-5);
    for (const [a, b, w] of [
      [1000, 0, true],
      [0, 3000, false],
      [1500, 1500, true],
    ] as const)
      expect(Math.abs(scoreChange(a, b, w, 1, limits))).toBeLessThanOrEqual(
        limits.arena.k,
      );
  });
});
