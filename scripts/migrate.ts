// 옛 사이트의 캐릭터를 새 저장 모양으로 옮긴다. 지금은 에뮬레이터에만 쓴다.
//
//   npx firebase emulators:exec --only database --project demo-garden \
//     "npm run migrate -- --input ../garden-data/firebase-export.json --target emulator"
//
// 내보내기 파일은 이 저장소 바깥(비공개 저장소 garden-data)에 있다. 결과 파일은 만들지 않고 요약만 찍는다.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { emulatorAdminPort } from "../src/data/emulator-admin";
import { selectEnv } from "../src/data/env";
import { writeMigrated } from "../src/data/migrate-write";
import { paths } from "../src/data/paths";
import { branchPoints, rootPoints } from "../src/rules/mastery";
import { convertCharacter, type ConvertedCharacter } from "../src/rules/migrate/convert";
import { readOldData } from "../src/rules/migrate/read-old";
import { checkDefs } from "../src/rules/validate-defs";
import { characterSchema } from "../src/schema/character";
import { keyToId } from "../src/schema/keys";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const input = arg("input") ?? fail("--input <내보내기 파일 경로> 가 필요하다");
const target = arg("target") ?? fail("--target emulator 가 필요하다");
if (resolve(input).startsWith(root + "/")) fail("내보내기 파일은 이 저장소 바깥에 두어야 한다");
// emulator가 아닌 환경은 여기서 걸러진다 (isTest: true → emulator만 허용)
const env = selectEnv(target, { isTest: true });

// 정의 데이터
const readDef = (file: string): unknown => JSON.parse(readFileSync(join(root, "data", "defs", file), "utf8"));
const trees: Record<string, unknown> = {};
for (const name of readdirSync(join(root, "data", "defs", "trees"))) trees[`trees/${name}`] = readDef(`trees/${name}`);
const defsResult = checkDefs({
  skillTable: readDef("skill-table.json"),
  effects: readDef("effects.json"),
  limits: readDef("limits.json"),
  items: readDef("items.json"),
  migration: readDef("migration.json"),
  talents: readDef("talents.json"),
  trees,
});
if (!defsResult.ok) fail(`정의 데이터에 문제가 있다: ${defsResult.issues[0]?.message ?? ""}`);
const defs = defsResult.ok ? defsResult.defs : fail("");

// 옛 사이트 소스에 박혀 있던 캐릭터 목록
const source = readFileSync(join(root, "docs", "old", "old-site-index.html"), "utf8");
const start = source.indexOf("const CHARS=[");
const end = source.indexOf("];", start);
if (start < 0 || end < 0) fail("옛 사이트 소스에서 CHARS 목록을 찾지 못했다");
const chars = runInNewContext(`(${source.slice(start + "const CHARS=".length, end + 1)})`, {}, { timeout: 1000 }) as unknown[];

const old = readOldData(JSON.parse(readFileSync(input, "utf8")), chars);
const calendar = old.calendar ?? fail("옛 세계 달력을 찾지 못했다");
const now = Date.now();

const converted: ConvertedCharacter[] = [];
const errors: string[] = [...old.problems];
for (const bundle of old.characters) {
  try {
    converted.push(
      convertCharacter(bundle, {
        migration: defs.migration,
        limits: defs.limits,
        talents: defs.talents.talents,
        items: defs.items.items,
        calendar,
        now,
        battles: old.battles,
        stories: old.stories,
      }),
    );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}
if (errors.length > 0) fail(`옮기지 않았다. 문제 ${errors.length}개:\n  ${errors.join("\n  ")}`);

const db = emulatorAdminPort(env, { host: process.env["FIREBASE_DATABASE_EMULATOR_HOST"] });
const report = await writeMigrated(db, env, defs.limits, converted);

// 다시 읽어 스키마를 통과하는지 확인
const schema = characterSchema(defs.limits);
for (const item of converted) {
  const stored = schema.safeParse(await db.get(paths.character(item.characterId)));
  if (!stored.success) fail(`${item.characterId}: 저장된 값이 스키마를 통과하지 못했다 (${stored.error.issues[0]?.message ?? ""})`);
}

console.log(`\n옮김 ${report.written.length}명, 건너뜀 ${report.skipped.length}명 (환경: ${env.name}, 세계 달력 ${calendar.year}년 ${calendar.month}번째 달)`);
console.log(`옛 기록: 전투 ${old.battles.length}건, 이야기 ${old.stories.length}건`);
console.log(`버린 것: ${Object.entries(old.skipped).map(([label, count]) => `${label} ${count}`).join(", ")}`);
const skillName = (key: string) => defs.migration.skills.find((s) => s.id === keyToId(key))?.name ?? key;
for (const { character, secrets } of converted) {
  const record = character.migration;
  console.log(`\n● ${character.profile.name} (${record?.oldPlayer ?? "?"})`);
  const a = character.abilities;
  console.log(`  능력치 ${a.health}/${a.spirit}/${a.credit}/${a.connections}/${a.reputation}, 지갑 ${character.wallet}, 물건 ${Object.keys(character.bag.stacks).length + Object.keys(character.bag.uniques).length}종, 인물 ${Object.keys(character.people).length}명, 일생 기록 ${character.life.length}줄`);
  const masteries = Object.entries(character.mastery)
    .sort((x, y) => y[1].value - x[1].value)
    .map(([key, m]) => `${skillName(key)} ${m.value} (${branchPoints(defs.skillTable, m.value)}/${rootPoints(defs.skillTable, m.value)}${m.passed60 ? ", 60 벽 통과" : ""})`);
  console.log(`  숙련도: ${masteries.join(", ") || "없음"}`);
  console.log(`  타고난 재능: ${character.talents.innate ? "드러남" : secrets.innate ? "숨김" : "없음"}, 얻은 재능 ${Object.keys(character.talents.acquired).length}개`);
  for (const item of record?.notMoved ?? []) console.log(`  옮기지 못함 — ${item.kind}: ${item.name}${item.detail ? ` (${item.detail.slice(0, 80)})` : ""}`);
  for (const note of record?.needsCheck ?? []) console.log(`  확인 필요 — ${note}`);
}
