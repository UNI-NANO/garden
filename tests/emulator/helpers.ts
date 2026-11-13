import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { DbPort } from "../../src/data/commit";
import { selectEnv } from "../../src/data/env";
import { makeCharacter } from "../helpers/fake-character";

const env = selectEnv("emulator", { isTest: true });
const [host = "127.0.0.1", port = "9000"] = (process.env["FIREBASE_DATABASE_EMULATOR_HOST"] ?? "").split(":");
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`에뮬레이터가 아닌 주소: ${host}`);

export const OWNER = "uid-owner";
export const OTHER = "uid-other";
export const GM = "uid-gm";
export const CID = "char-1";

export async function startTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: env.firebase.projectId,
    database: {
      host,
      port: Number(port),
      rules: readFileSync(join(import.meta.dirname, "..", "..", "database.rules.json"), "utf8"),
    },
  });
}

type Database = ReturnType<RulesTestContext["database"]>;

/** 규칙을 건너뛰고 처음 상태를 만든다: GM 한 명, OWNER의 캐릭터 하나 */
export async function seed(testEnv: RulesTestEnvironment, character: unknown = makeCharacter(OWNER)): Promise<void> {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set({ gm: { [GM]: true }, characters: { [CID]: character } });
  });
}

export async function readAll(testEnv: RulesTestEnvironment, path: string): Promise<unknown> {
  let value: unknown;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    value = (await context.database().ref(path).get()).val();
  });
  return value;
}

export function portOf(database: Database): DbPort {
  return {
    get: async (path) => (await database.ref(path).get()).val() as unknown,
    update: async (updates) => {
      try {
        await database.ref().update(updates);
        return "ok";
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code.toUpperCase().includes("PERMISSION_DENIED")) return "denied";
        throw error;
      }
    },
  };
}
