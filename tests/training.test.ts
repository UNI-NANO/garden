import { describe, expect, it } from "vitest";
import { effectDefs } from "../src/rules/battle/effects";
import { simulateBattle } from "../src/rules/battle/simulate";
import {
  blockedWalls,
  dummyBattle,
  isBlocked,
  wallBattle,
  wallStatus,
} from "../src/rules/training";
import { idToKey } from "../src/schema/keys";
import { makeCharacter } from "./helpers/fake-character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const ground = defs.training.grounds[0]!;
const battleDefs = {
  skillTable: defs.skillTable,
  effects: defs.effects.effects,
  battle: defs.battle,
  trees: defs.trees,
  enemies: defs.enemies.enemies,
};
const ctx = {
  rules: defs.battle,
  table: defs.skillTable,
  effects: effectDefs(defs.effects.effects),
};

function withSword(value: number, passed60 = false, passed80 = false) {
  const character = makeCharacter();
  character.mastery[idToKey("sword")] = { value, passed60, passed80 };
  return character;
}

describe("훈련장 — 막힌 벽", () => {
  it("59.99에서 60 벽, 79.99에서 80 벽에 막힌다", () => {
    expect(
      blockedWalls(withSword(59.99), ground, defs.trees).map((b) => [
        b.skill,
        b.wall.at,
      ]),
    ).toEqual([["sword", 60]]);
    expect(
      blockedWalls(withSword(79.99, true), ground, defs.trees).map(
        (b) => b.wall.at,
      ),
    ).toEqual([80]);
  });

  it("벽 아래이거나 이미 통과했으면 막히지 않는다", () => {
    expect(blockedWalls(withSword(59.98), ground, defs.trees)).toEqual([]);
    expect(blockedWalls(withSword(59.99, true), ground, defs.trees)).toEqual(
      [],
    );
    expect(
      blockedWalls(withSword(79.99, true, true), ground, defs.trees),
    ).toEqual([]);
    expect(blockedWalls(makeCharacter(), ground, defs.trees)).toEqual([]);
    // 60을 통과하지 않은 채로 80 근처 값(옮겨 온 값 등)이면 60 벽만
    expect(isBlocked(withSword(79.99), "sword", 80)).toBe(false);
  });

  it("나무가 없는 기술은 벽 시험이 없다", () => {
    const character = withSword(59.99);
    character.mastery[idToKey("medicine")] = {
      value: 59.99,
      passed60: false,
      passed80: false,
    };
    expect(
      blockedWalls(character, ground, defs.trees).map((b) => b.skill),
    ).toEqual(["sword"]);
  });

  it("기술마다 숙련도와 벽 상태", () => {
    expect(wallStatus(withSword(61.5, true), defs.trees)).toEqual([
      {
        skill: "sword",
        skillName: "검술",
        value: 61.5,
        passed60: true,
        passed80: false,
      },
    ]);
  });
});

describe("훈련장 — 전투", () => {
  it("허수아비는 맞아도 피해를 주지 않는다", () => {
    const setup = dummyBattle(makeCharacter(), ground, battleDefs, "s1");
    const result = simulateBattle(setup, ctx, "자동", 8);
    const player = result.final.allies[0]!;
    expect(result.turns).toBeGreaterThan(1);
    expect(player.hp).toBe(player.maxHp);
    expect(result.final.enemies[0]!.hp).toBeLessThan(
      result.final.enemies[0]!.maxHp,
    );
  });

  it("교관 대련은 그 벽의 적과, 그 기술의 나무로", () => {
    const blocked = blockedWalls(withSword(59.99), ground, defs.trees)[0]!;
    const setup = wallBattle(withSword(59.99), blocked, battleDefs, "s2");
    expect(setup.enemies.map((e) => e.def.id)).toEqual(
      blocked.wall.enemies.map((m) => m.enemy),
    );
    expect(setup.allies[0]!.mastery).toBe(59.99);
  });
});
