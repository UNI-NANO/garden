import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDefs, checkDungeons, checkFishing, checkGathering, checkHunting, checkCrafting, checkEnhance } from "../../src/rules/validate-defs";

/** 실제 정의 데이터(data/defs)를 검사해 읽는다. 시험 여러 곳이 같이 쓴다 */
const root = join(import.meta.dirname, "..", "..", "data", "defs");
const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), "utf8"));

export function realDefs() {
  const trees: Record<string, unknown> = {};
  for (const name of readdirSync(join(root, "trees"))) trees[`trees/${name}`] = read(`trees/${name}`);
  const result = checkDefs({
    skillTable: read("skill-table.json"),
    effects: read("effects.json"),
    limits: read("limits.json"),
    items: read("items.json"),
    migration: read("migration.json"),
    talents: read("talents.json"),
    battle: read("battle.json"),
    enemies: read("enemies.json"),
    trees,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const dungeons = checkDungeons(read("dungeons.json"), result.defs);
  if (!dungeons.ok) throw new Error(JSON.stringify(dungeons.issues));
  const fishing = checkFishing(read("fishing.json"), result.defs);
  if (!fishing.ok) throw new Error(JSON.stringify(fishing.issues));
  const gathering = checkGathering(read("gathering.json"), result.defs);
  if (!gathering.ok) throw new Error(JSON.stringify(gathering.issues));
  const hunting = checkHunting(read("hunting.json"), result.defs);
  if (!hunting.ok) throw new Error(JSON.stringify(hunting.issues));
  const crafting = checkCrafting(read("crafting.json"), result.defs);
  if (!crafting.ok) throw new Error(JSON.stringify(crafting.issues));
  const enhance = checkEnhance(read("enhance.json"), result.defs);
  if (!enhance.ok) throw new Error(JSON.stringify(enhance.issues));
  return {
    ...result.defs,
    dungeons: dungeons.dungeons.dungeons,
    fishing: fishing.fishing,
    gathering: gathering.gathering,
    hunting: hunting.hunting,
    crafting: crafting.crafting,
    enhance: enhance.enhance, itemMap: new Map(result.defs.items.items.map((i) => [i.id, i])) };
}
