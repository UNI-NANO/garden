import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSkillNumbersFromSpec } from "../src/rules/skill-table";
import { checkDefs } from "../src/rules/validate-defs";

const root = join(import.meta.dirname, "..", "data", "defs");
const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), "utf8"));
const trees: Record<string, unknown> = {};
for (const name of readdirSync(join(root, "trees"))) trees[`trees/${name}`] = read(`trees/${name}`);
const result = checkDefs({ skillTable: read("skill-table.json"), effects: read("effects.json"), trees });

describe("실제 정의 데이터 (data/defs)", () => {
  it("검사를 통과한다", () => {
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  if (!result.ok) return;
  const { skillTable, effects } = result.defs;
  const sword = result.defs.trees.find((t) => t.id === "sword");
  const numbers = (id: string) => {
    const spec = id === sword?.basicAttack.id ? sword.basicAttack.skill : sword?.nodes.find((n) => n.id === id)?.skill;
    if (!spec) throw new Error(`기술 없음: ${id}`);
    return computeSkillNumbersFromSpec(skillTable, effects.effects, spec);
  };

  describe("검술 나무", () => {
    it("칸 수: 기본기 넷 × 21칸 + 숨은 칼등 갈래 3칸", () => {
      expect(sword?.nodes).toHaveLength(4 * 21 + 3);
      expect(sword?.nodes.filter((n) => n.kind === "궁극기")).toHaveLength(16 + 1);
      expect(sword?.nodes.filter((n) => n.hidden).map((n) => n.name)).toEqual(["칼등"]);
    });
    it("기획서에 적힌 숫자와 맞는다", () => {
      const gale = numbers("sword.gale");
      expect(gale.totalPower).toBeCloseTo(13.5, 10);
      expect([gale.cooldown, gale.energy]).toEqual([4, 3]);

      const charge = numbers("sword.charge");
      expect(Math.round(charge.totalPower)).toBe(14);
      expect([charge.cooldown, charge.energy]).toEqual([3, 2]);

      expect(numbers("sword.riposte").totalPower).toBeCloseTo(11, 10);
      expect(numbers("sword.cut")).toMatchObject({ totalPower: 6, cooldown: 0, energy: 0 });
    });
    it("연계 역할이 갈림길에서 바뀐다", () => {
      const roleOf = (id: string) => {
        const node = sword?.nodes.find((n) => n.id === id);
        return node?.skill?.role ?? node?.overrides?.role;
      };
      expect([roleOf("sword.combo"), roleOf("sword.combo.b")]).toEqual(["잇는", "끝내는"]);
      expect([roleOf("sword.gale.a"), roleOf("sword.gale.b")]).toEqual(["여는", "잇는"]);
      expect([roleOf("sword.riposte.a"), roleOf("sword.riposte.b")]).toEqual(["끝내는", "잇는"]);
      expect([roleOf("sword.charge.a"), roleOf("sword.charge.b")]).toEqual(["여는", "끝내는"]);
    });
    it("연속 베기: 1단계 · 약함 · 3타 · 출혈(가벼운 효과 하나)", () => {
      const combo = numbers("sword.combo");
      expect(combo.totalPower).toBeCloseTo(8 * 0.75 * 1.2 * 0.9, 10);
      expect(combo.hitCount).toBe(3);
      expect([combo.cooldown, combo.energy]).toEqual([1, 1]);
    });
  });
});
