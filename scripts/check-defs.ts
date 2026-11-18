// 정의 데이터(data/defs)를 읽어 검사한다. 문제가 있으면 목록을 찍고 실패한다.
//   npm run check:defs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDefs, checkDungeons, checkFishing, checkGathering, checkHunting, checkCrafting, checkEnhance, checkTraining, checkArena, type DefIssue } from "../src/rules/validate-defs";

const root = join(import.meta.dirname, "..", "data", "defs");
const issues: DefIssue[] = [];

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch (error) {
    issues.push({ file, where: "(파일)", message: `읽지 못했다: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
}

const trees: Record<string, unknown> = {};
for (const name of readdirSync(join(root, "trees")).sort()) {
  if (name.endsWith(".json")) trees[`trees/${name}`] = readJson(`trees/${name}`);
}
const raw = {
  skillTable: readJson("skill-table.json"),
  effects: readJson("effects.json"),
  limits: readJson("limits.json"),
  items: readJson("items.json"),
  migration: readJson("migration.json"),
  talents: readJson("talents.json"),
  battle: readJson("battle.json"),
  enemies: readJson("enemies.json"),
  trees,
};

if (issues.length === 0) {
  const result = checkDefs(raw);
  if (result.ok) {
    const dungeons = checkDungeons(readJson("dungeons.json"), result.defs);
    if (!dungeons.ok) issues.push(...dungeons.issues);
    const fishing = checkFishing(readJson("fishing.json"), result.defs);
    if (!fishing.ok) issues.push(...fishing.issues);
    const gathering = checkGathering(readJson("gathering.json"), result.defs);
    if (!gathering.ok) issues.push(...gathering.issues);
    const hunting = checkHunting(readJson("hunting.json"), result.defs);
    if (!hunting.ok) issues.push(...hunting.issues);
    const crafting = checkCrafting(readJson("crafting.json"), result.defs);
    if (!crafting.ok) issues.push(...crafting.issues);
    const enhance = checkEnhance(readJson("enhance.json"), result.defs);
    if (!enhance.ok) issues.push(...enhance.issues);
    const training = checkTraining(readJson("training.json"), result.defs);
    if (!training.ok) issues.push(...training.issues);
    const arena = checkArena(readJson("arena.json"));
    if (!arena.ok) issues.push(...arena.issues);
    const nodes = result.defs.trees.reduce((sum, tree) => sum + tree.nodes.length, 0);
    console.log(`정의 데이터 통과: 나무 ${result.defs.trees.length}그루, 칸 ${nodes}개, 효과 ${result.defs.effects.effects.length}개, 물건 ${result.defs.items.items.length}개, 던전 ${dungeons.ok ? dungeons.dungeons.dungeons.length : "?"}개, 낚시터 ${fishing.ok ? fishing.fishing.spots.length : "?"}곳, 채집터 ${gathering.ok ? gathering.gathering.spots.length : "?"}곳, 사냥터 ${hunting.ok ? hunting.hunting.grounds.length : "?"}곳, 레시피 ${crafting.ok ? crafting.crafting.recipes.length : "?"}개, 훈련장 ${training.ok ? training.training.grounds.length : "?"}곳, 투기장 ${arena.ok ? arena.arena.arenas.length : "?"}곳`);
  } else {
    issues.push(...result.issues);
  }
}

if (issues.length > 0) {
  console.error(`정의 데이터에 문제 ${issues.length}개:`);
  for (const issue of issues) console.error(`  ${issue.file} › ${issue.where}: ${issue.message}`);
  process.exit(1);
}
