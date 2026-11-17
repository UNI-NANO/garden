// 대본집(docs/대본집.md)의 모든 장면이 「대본 형식」대로 읽히는지, 흐름(갈래·합류·끝)이 맞는지 본다.
//   npm run check:scenes
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScriptBook } from "../src/rules/scene/parse";
import { playThrough } from "../src/rules/scene/run";

const book = readFileSync(join(import.meta.dirname, "..", "docs", "대본집.md"), "utf8");
const { scenes, issues } = parseScriptBook(book);
if (issues.length > 0) {
  console.error(`대본집에 문제가 ${issues.length}곳 있다:`);
  for (const issue of issues) console.error(`  ${issue.line}줄 (${issue.scene}): ${issue.message}`);
  process.exit(1);
}
// 모든 장면을 기본 선택(첫 선택지, 전투 이김)으로 끝까지 돌려 본다
const empty = { name: "시험", vars: {}, marks: new Set<string>(), worldMarks: new Set<string>(), clues: new Set<string>(), quests: new Set<string>(), talents: new Set<string>(), numbers: {} };
for (const scene of scenes) playThrough(scene, empty);
console.log(`대본집 통과: 장면 ${scenes.length}개`);
