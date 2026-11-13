// 추적 중인 파일에 비공개 데이터(옛 내보내기, 변환 결과)가 없는지 확인한다.
//   npm run check:private
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPrivateData } from "../src/data/private-data-guard";

const root = join(import.meta.dirname, "..");
const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const files = paths.map((path) => ({
  path,
  content: path.endsWith(".json") ? readFileSync(join(root, path), "utf8") : undefined,
}));

const found = findPrivateData(files);
if (found.length > 0) {
  console.error("이 저장소에 두면 안 되는 비공개 데이터가 있다:");
  for (const item of found) console.error(`  ${item.path} — ${item.why}`);
  console.error("옛 내보내기 파일과 변환 결과는 비공개 저장소 garden-data에만 둔다.");
  process.exit(1);
}
console.log(`비공개 데이터 없음 (파일 ${paths.length}개 확인)`);
