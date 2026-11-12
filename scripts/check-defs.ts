// 정의 데이터(data/defs)를 읽어 검사한다. 문제가 있으면 목록을 찍고 실패한다.
//   npm run check:defs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDefs, type DefIssue } from "../src/rules/validate-defs";

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
const raw = { skillTable: readJson("skill-table.json"), effects: readJson("effects.json"), trees };

if (issues.length === 0) {
  const result = checkDefs(raw);
  if (result.ok) {
    const nodes = result.defs.trees.reduce((sum, tree) => sum + tree.nodes.length, 0);
    console.log(`정의 데이터 통과: 나무 ${result.defs.trees.length}그루, 칸 ${nodes}개, 효과 ${result.defs.effects.effects.length}개`);
  } else {
    issues.push(...result.issues);
  }
}

if (issues.length > 0) {
  console.error(`정의 데이터에 문제 ${issues.length}개:`);
  for (const issue of issues) console.error(`  ${issue.file} › ${issue.where}: ${issue.message}`);
  process.exit(1);
}
