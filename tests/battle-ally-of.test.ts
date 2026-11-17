import { describe, expect, it } from "vitest";
import { allyOfCharacter, allyVitals } from "../src/rules/battle/ally-of";
import { buildSkill } from "../src/rules/battle/build-skill";
import { createBattle } from "../src/rules/battle/engine";
import { effectDefs } from "../src/rules/battle/effects";
import { idToKey } from "../src/schema/keys";
import { makeCharacter } from "./helpers/fake-character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const allyDefs = { skillTable: defs.skillTable, effects: defs.effects.effects, battle: defs.battle, trees: defs.trees };
const sword = defs.trees.find((t) => t.id === "sword")!;

describe("캐릭터 → 전투 아군", () => {
  it("장착이 없으면 기본 공격만, 숙련·건강은 캐릭터 값", () => {
    const character = makeCharacter();
    character.mastery[idToKey("sword")] = { value: 42, passed60: false, passed80: false };
    const { ally, problems } = allyOfCharacter(character, allyDefs);
    expect(problems).toEqual([]);
    expect(ally.skills).toEqual([]);
    expect(ally.basicAttack.id).toBe(sword.basicAttack.id);
    expect([ally.mastery, ally.health, ally.name]).toEqual([42, character.abilities.health, character.profile.name]);
  });

  it("장착한 기본기는 찍은 칸까지 반영하고, 잘못된 장착은 빼고 알린다", () => {
    const character = makeCharacter();
    const picked = ["sword.combo", "sword.combo.s1", "sword.combo.s2"];
    character.trees[idToKey("sword")] = { treeVersion: sword.version, picked: Object.fromEntries(picked.map((id) => [idToKey(id), true])), choices: {}, spent: { branch: 3, root: 0 } };
    character.loadout = { basics: ["sword.combo", "sword.nothing"], ultimate: "sword.combo.a1.u" };
    const { ally, problems } = allyOfCharacter(character, allyDefs);
    const expected = buildSkill(defs.skillTable, defs.effects.effects, defs.battle.words, sword, "sword.combo", { picked: new Set(picked), choices: {} }, "근접");
    expect(ally.skills).toEqual([expected]);
    expect(ally.ultimate).toBeUndefined();
    expect(problems).toHaveLength(2);
  });

  it("이어지는 체력·기력으로 전투를 연다 (최대를 넘지 않음)", () => {
    const character = makeCharacter();
    const { maxHp, maxEnergy } = allyVitals(character, allyDefs);
    const ctx = { rules: defs.battle, table: defs.skillTable, effects: effectDefs(defs.effects.effects) };
    const wolf = defs.enemies.enemies.find((e) => e.id === "wolf")!;
    const open = (hp: number, energy: number) =>
      createBattle({ id: "b", kind: "일반", seed: "s", allies: [allyOfCharacter(character, allyDefs, { hp, energy }).ally], enemies: [{ id: "w", def: wolf, slot: 1 }] }, ctx).allies[0]!;
    expect([open(10, 2).hp, open(10, 2).energy]).toEqual([10, 2]);
    expect([open(maxHp + 50, maxEnergy + 5).hp, open(maxHp + 50, maxEnergy + 5).energy]).toEqual([maxHp, maxEnergy]);
  });
});
