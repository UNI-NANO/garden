import { describe, expect, it } from "vitest";
import rawBattle from "../data/defs/battle.json";
import rawEffects from "../data/defs/effects.json";
import rawEnemies from "../data/defs/enemies.json";
import rawTable from "../data/defs/skill-table.json";
import rawSword from "../data/defs/trees/sword.json";
import { createBattle } from "../src/rules/battle/engine";
import { buildPractice, practiceRoutes, PracticeError, type PracticeChoice } from "../src/rules/battle/practice";
import { BattleRulesSchema, EnemyListSchema } from "../src/schema/defs/battle";
import { EffectListSchema } from "../src/schema/defs/effect";
import { SkillTableSchema } from "../src/schema/defs/skill-table";
import { TreeSchema } from "../src/schema/defs/tree";
import { ctx } from "./helpers/fake-battle";

const defs = {
  skillTable: SkillTableSchema.parse(rawTable),
  effects: EffectListSchema.parse(rawEffects).effects,
  battle: BattleRulesSchema.parse(rawBattle),
  enemies: EnemyListSchema.parse(rawEnemies).enemies,
  tree: TreeSchema.parse(rawSword),
};
const base: PracticeChoice = {
  basics: [{ id: "sword.combo" }, { id: "sword.gale" }, { id: "sword.charge" }],
  foes: "늑대 하나",
  party: "혼자",
  seed: "연습",
};

describe("연습 전투 편성", () => {
  it("기본기마다 끝갈래 루트와 그 궁극기를 고를 수 있다 (숨은 갈래 포함)", () => {
    expect(practiceRoutes(defs.tree, "sword.gale").map((r) => [r.name, r.ultimateName])).toEqual([
      ["끈질김", "멎지 않는 바람"],
      ["마무리", "풀베기"],
      ["빠르게", "칼바람 한 줄기"],
      ["무겁게", "산 가르기"],
      ["칼등", "역날의 마음"],
    ]);
  });
  it("기본 모양만 고르면 기본기 그대로, 궁극기 없음", () => {
    const setup = buildPractice(defs, base);
    const player = setup.allies[0]!;
    expect(player).toMatchObject({ kind: "플레이어", mastery: 30, health: 50 });
    expect(player.skills.map((s) => s.id)).toEqual(["sword.combo", "sword.gale", "sword.charge"]);
    expect(player.ultimate).toBeUndefined();
    expect(setup.enemies.map((e) => e.def.id)).toEqual(["wolf"]);
    expect(() => createBattle(setup, ctx)).not.toThrow();
  });
  it("루트를 고르면 그 끝갈래까지 찍은 기술, 그 루트의 궁극기를 든다", () => {
    const setup = buildPractice(defs, {
      ...base,
      basics: [{ id: "sword.combo" }, { id: "sword.gale", route: "sword.gale.b1" }, { id: "sword.charge" }],
      ultimateRoute: "sword.gale.b1",
      foes: "방패병 + 석궁병",
      party: "동료 둘과",
    });
    const player = setup.allies[0]!;
    // 검풍 깊게(단일) + 빠르게(쿨다운 −2)
    expect(player.skills[1]).toMatchObject({ range: "단일", cooldown: 2 });
    expect(player.ultimate).toMatchObject({ id: "sword.gale.b1.u", name: "칼바람 한 줄기" });
    expect(setup.allies.map((a) => [a.id, a.slot, a.skills.length])).toEqual([
      ["player", 1, 3],
      ["mate1", 0, 0],
      ["mate2", 2, 0],
    ]);
    expect(setup.enemies.map((e) => [e.def.id, e.slot])).toEqual([
      ["deserter.shield", 1],
      ["deserter.crossbow", 4],
    ]);
    expect(() => createBattle(setup, ctx)).not.toThrow();
  });
  it("고를 수 없는 것은 막는다", () => {
    expect(() => buildPractice(defs, { ...base, ultimateRoute: "sword.gale.b1" })).toThrow(PracticeError);
    expect(() => buildPractice(defs, { ...base, basics: base.basics.slice(0, 2) })).toThrow("3개");
    expect(() => buildPractice(defs, { ...base, basics: [{ id: "sword.combo" }, { id: "sword.combo" }, { id: "sword.gale" }] })).toThrow("두 번");
    expect(() => buildPractice(defs, { ...base, basics: [{ id: "sword.combo", route: "sword.gale.b1" }, { id: "sword.gale" }, { id: "sword.charge" }] })).toThrow("없는 루트");
  });
});
