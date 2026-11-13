// 실제 환경 빌드(dist)에 시험용 기능이 들어가지 않았는지 확인한다. `npm run build` 뒤에 돈다.
//   npm run check:build
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist", "assets");
const forbidden = ["시험 계정으로 들어가기", "example.test"];
const problems: string[] = [];
let scripts = 0;
for (const name of readdirSync(dist)) {
  if (!name.endsWith(".js")) continue;
  scripts++;
  const text = readFileSync(join(dist, name), "utf8");
  for (const word of forbidden) if (text.includes(word)) problems.push(`${name}: 「${word}」`);
}
if (scripts === 0) problems.push("빌드 결과가 없다");
if (problems.length > 0) {
  console.error("실제 환경 빌드에 시험용 기능이 들어 있다:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`실제 환경 빌드에 시험용 기능 없음 (스크립트 ${scripts}개 확인)`);
