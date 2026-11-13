import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import rawItems from "../../data/defs/items.json";
import rawMigration from "../../data/defs/migration.json";
import rawTalents from "../../data/defs/talents.json";
import { commitExchange } from "../../src/data/commit";
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { MigrationWriteError, writeMigrated } from "../../src/data/migrate-write";
import { applyExchange } from "../../src/rules/exchange";
import { convertCharacter, migratedCharacterId } from "../../src/rules/migrate/convert";
import { readOldData } from "../../src/rules/migrate/read-old";
import { characterSchema } from "../../src/schema/character";
import { ItemListSchema } from "../../src/schema/defs/item";
import { MigrationSchema } from "../../src/schema/defs/migration";
import { TalentListSchema } from "../../src/schema/defs/talent";
import { sampleChars, sampleExport } from "../fixtures/old-sample";
import { limits } from "../helpers/fake-character";
import { GM, OTHER, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => void (await seed(testEnv)));

const env = selectEnv("emulator", { isTest: true });
// 규칙 테스트 도구는 프로젝트 이름과 같은 이름의 데이터베이스를 쓴다
const admin = () => emulatorAdminPort(env, { host: process.env["FIREBASE_DATABASE_EMULATOR_HOST"], namespace: env.firebase.projectId });
const items = ItemListSchema.parse(rawItems).items;
const old = readOldData(sampleExport(), sampleChars());
const converted = old.characters.map((bundle) =>
  convertCharacter(bundle, {
    migration: MigrationSchema.parse(rawMigration),
    limits,
    talents: TalentListSchema.parse(rawTalents).talents,
    items,
    calendar: old.calendar ?? { year: 514, month: 1 },
    now: Date.now(),
    battles: old.battles,
    stories: old.stories,
  }),
);
const ID = migratedCharacterId("가람");
const as = (uid: string) => testEnv.authenticatedContext(uid).database();

describe("이전 결과를 에뮬레이터에 쓰기", () => {
  it("모두 쓰이고, 다시 읽은 캐릭터가 스키마를 통과한다", async () => {
    const report = await writeMigrated(admin(), env, limits, converted);
    expect(report).toEqual({ written: converted.map((c) => c.characterId), skipped: [] });
    for (const item of converted) {
      const stored = characterSchema(limits).parse(await readAll(testEnv, `characters/${item.characterId}`));
      expect(stored).toEqual(characterSchema(limits).parse(item.character));
    }
    expect(await readAll(testEnv, `secrets/${ID}`)).toMatchObject({ notes: ["벨로 경: 사실은 원수의 친구"] });
  });

  it("다시 실행하면 이미 옮긴 캐릭터는 건너뛰고 덮어쓰지 않는다", async () => {
    await writeMigrated(admin(), env, limits, converted);
    await admin().update({ [`characters/${ID}/wallet`]: 999 });
    const again = await writeMigrated(admin(), env, limits, converted);
    expect(again).toEqual({ written: [], skipped: converted.map((c) => c.characterId) });
    expect(await readAll(testEnv, `characters/${ID}/wallet`)).toBe(999);
  });

  it("에뮬레이터가 아닌 환경에는 쓰지 않는다", async () => {
    const before = await readAll(testEnv, "/");
    await expect(writeMigrated(admin(), { name: "prod" }, limits, converted)).rejects.toThrow(MigrationWriteError);
    await expect(writeMigrated(admin(), { name: "staging" }, limits, converted)).rejects.toThrow(MigrationWriteError);
    expect(await readAll(testEnv, "/")).toEqual(before);
    expect(() => emulatorAdminPort(env, { host: "example.com:443" })).toThrow();
  });

  it("하나라도 스키마를 통과하지 못하면 아무것도 쓰지 않는다", async () => {
    const before = await readAll(testEnv, "/");
    const broken = structuredClone(converted);
    broken[broken.length - 1]!.character.wallet = -5;
    await expect(writeMigrated(admin(), env, limits, broken)).rejects.toThrow(/스키마/);
    expect(await readAll(testEnv, "/")).toEqual(before);
  });
});

describe("옮겨진 캐릭터와 보안 규칙", () => {
  beforeEach(async () => void (await writeMigrated(admin(), env, limits, converted)));

  it("주인이 없는 동안은 GM만 읽는다. 비밀은 GM만 읽는다", async () => {
    await assertFails(as(OWNER).ref(`characters/${ID}`).get());
    await assertSucceeds(as(GM).ref(`characters/${ID}`).get());
    await assertFails(as(OWNER).ref(`secrets/${ID}`).get());
    await assertSucceeds(as(GM).ref(`secrets/${ID}`).get());
  });

  it("GM이 주인을 연결하면 그 계정이 읽고, 주고받기가 그대로 동작한다", async () => {
    await assertSucceeds(as(GM).ref(`characters/${ID}/meta/owner`).set(OWNER));
    await assertSucceeds(as(OWNER).ref(`characters/${ID}`).get());
    await assertFails(as(OTHER).ref(`characters/${ID}`).get());
    await assertFails(as(OWNER).ref(`secrets/${ID}`).get());

    const now = Date.now();
    const context = { now, limits, items: new Map(items.map((item) => [item.id, item])), carryLimit: 100 };
    const result = await commitExchange(
      portOf(as(OWNER)),
      ID,
      "req-after-migration",
      (state) =>
        applyExchange(state, { requestId: "req-after-migration", reason: "이전 뒤 첫 구매", walletDelta: -54, gains: [], losses: [], overflow: "거절" }, context),
      { limits, now },
    );
    expect(result.status).toBe("ok");
    expect(await readAll(testEnv, `characters/${ID}/wallet`)).toBe(100);
  });
});
