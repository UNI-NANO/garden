// 하루 계산. GitHub Actions(.github/workflows/daily.yml)가 돌린다. 지금은 에뮬레이터에만 쓴다.
//
//   npx firebase emulators:exec --only database --project demo-garden \
//     "npm run daily -- --target emulator --backup-dir /tmp/garden-backup"
//
// 실제·시험용 Firebase에 연결하는 것(관리자 키는 GitHub Secrets에만)은 배포 단계에서 한다.
// 백업은 이 저장소(공개) 바깥의 폴더에 날짜별 파일로 쓴다. 워크플로가 그것을 비공개 저장소 garden-data에 올린다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runDaily } from "../src/data/daily";
import { emulatorAdminPort } from "../src/data/emulator-admin";
import { selectEnv } from "../src/data/env";
import { LimitsSchema } from "../src/schema/defs/limits";

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

const target = arg("target") ?? fail("--target emulator 가 필요하다");
// emulator가 아닌 환경은 여기서 걸러진다 (isTest: true → emulator만 허용)
const env = selectEnv(target, { isTest: true });
const backupDir = arg("backup-dir");
if (backupDir !== undefined && (resolve(backupDir) + "/").startsWith(root + "/")) fail("백업은 이 저장소(공개) 바깥에 두어야 한다");

const limits = LimitsSchema.parse(JSON.parse(readFileSync(join(root, "data", "defs", "limits.json"), "utf8")));
const report = await runDaily(emulatorAdminPort(env), {
  limits,
  now: Date.now(),
  ...(backupDir !== undefined
    ? {
        backup: async (dateKey: string, data: unknown) => {
          mkdirSync(backupDir, { recursive: true });
          const file = join(backupDir, `${dateKey}.json`);
          writeFileSync(file, JSON.stringify(data));
          return file;
        },
      }
    : {}),
});
console.log(`처리한 날: ${report.days.length > 0 ? report.days.join(", ") : "없음"}`);
for (const note of report.notes) console.log(`- ${note}`);
