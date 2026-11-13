import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { linkCharacter } from "../../src/data/link-character";
import { AccountSchema } from "../../src/schema/account";
import { makeCharacter } from "../helpers/fake-character";
import { CID, GM, OTHER, OWNER, readAll, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

const env = selectEnv("emulator", { isTest: true });
const admin = () => emulatorAdminPort(env, { host: process.env["FIREBASE_DATABASE_EMULATOR_HOST"], namespace: env.firebase.projectId });
const as = (uid: string) => testEnv.authenticatedContext(uid).database();
const anon = () => testEnv.unauthenticatedContext().database();
const NEW = "uid-new";
const ownerless = (stage = "살아 있음") => {
  const { owner: _none, ...meta } = makeCharacter(OWNER).meta;
  void _none;
  return { ...makeCharacter(OWNER), meta: { ...meta, stage } };
};

beforeEach(async () => {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set({ gm: { [GM]: true }, characters: { [CID]: ownerless(), "char-2": ownerless() } });
  });
});

describe("계정 기록", () => {
  const first = () => ({ [`accounts/${NEW}/displayName`]: "새 사람", [`accounts/${NEW}/createdAt`]: Date.now(), [`accounts/${NEW}/lastSeenAt`]: Date.now() });

  it("처음 들어온 사람은 자기 계정 기록을 만들고, 스키마를 통과한다", async () => {
    await assertSucceeds(as(NEW).ref().update(first()));
    expect(AccountSchema.safeParse(await readAll(testEnv, `accounts/${NEW}`)).success).toBe(true);
  });
  it("표시 이름과 마지막 접속은 고칠 수 있고, 처음 들어온 때는 못 고친다", async () => {
    await as(NEW).ref().update(first());
    await assertSucceeds(as(NEW).ref(`accounts/${NEW}/lastSeenAt`).set(Date.now()));
    await assertSucceeds(as(NEW).ref(`accounts/${NEW}/displayName`).set("바꾼 이름"));
    await assertFails(as(NEW).ref(`accounts/${NEW}/createdAt`).set(1));
    await assertFails(as(NEW).ref(`accounts/${NEW}/displayName`).set("가".repeat(81)));
  });
  it("자기 캐릭터 연결을 스스로 쓸 수 없다", async () => {
    await as(NEW).ref().update(first());
    await assertFails(as(NEW).ref(`accounts/${NEW}/characterId`).set(CID));
    await assertFails(as(NEW).ref(`accounts/${NEW}`).set({ displayName: "x", createdAt: 1, lastSeenAt: 1, characterId: CID }));
    await assertFails(as(NEW).ref(`characters/${CID}/meta/owner`).set(NEW));
    await assertFails(as(NEW).ref(`accounts/${NEW}/admin`).set(true));
  });
  it("남의 계정은 읽지도 쓰지도 못한다. GM은 읽는다", async () => {
    await as(NEW).ref().update(first());
    await assertFails(as(OTHER).ref(`accounts/${NEW}`).get());
    await assertFails(as(OTHER).ref(`accounts/${NEW}/displayName`).set("x"));
    await assertFails(anon().ref(`accounts/${NEW}`).get());
    await assertSucceeds(as(NEW).ref(`accounts/${NEW}`).get());
    await assertSucceeds(as(GM).ref(`accounts/${NEW}`).get());
    await assertSucceeds(as(GM).ref("accounts").get());
    await assertFails(as(NEW).ref("accounts").get());
  });
});

describe("계정과 캐릭터 잇기", () => {
  it("계정 쪽과 캐릭터 쪽이 한 번에 이어지고, 그 계정만 캐릭터를 읽는다", async () => {
    await assertFails(as(NEW).ref(`characters/${CID}`).get());
    expect(await linkCharacter(admin(), NEW, CID)).toEqual({ ok: true });
    expect(await readAll(testEnv, `accounts/${NEW}/characterId`)).toBe(CID);
    expect(await readAll(testEnv, `characters/${CID}/meta/owner`)).toBe(NEW);
    await assertSucceeds(as(NEW).ref(`characters/${CID}`).get());
    await assertFails(as(OTHER).ref(`characters/${CID}`).get());
  });
  it("GM 계정도 규칙 안에서 이을 수 있다", async () => {
    await assertSucceeds(as(GM).ref().update({ [`accounts/${NEW}/characterId`]: CID, [`characters/${CID}/meta/owner`]: NEW }));
  });
  it("같은 연결을 다시 해도 된다", async () => {
    await linkCharacter(admin(), NEW, CID);
    expect(await linkCharacter(admin(), NEW, CID)).toEqual({ ok: true });
  });
  it("이미 주인이 있는 캐릭터는 다른 계정에 잇지 않는다", async () => {
    await linkCharacter(admin(), NEW, CID);
    expect(await linkCharacter(admin(), OTHER, CID)).toEqual({ ok: false, reason: "이미 주인이 있는 캐릭터" });
    expect(await readAll(testEnv, `characters/${CID}/meta/owner`)).toBe(NEW);
    expect(await readAll(testEnv, `accounts/${OTHER}`)).toBeNull();
  });
  it("살아 있는 캐릭터가 있는 계정에는 하나 더 잇지 않는다. 죽은 뒤에는 된다", async () => {
    await linkCharacter(admin(), NEW, CID);
    expect(await linkCharacter(admin(), NEW, "char-2")).toEqual({ ok: false, reason: "이미 살아 있는 캐릭터가 있는 계정" });
    await admin().update({ [`characters/${CID}/meta/stage`]: "죽음" });
    expect(await linkCharacter(admin(), NEW, "char-2")).toEqual({ ok: true });
    expect(await readAll(testEnv, `accounts/${NEW}/characterId`)).toBe("char-2");
  });
  it("없는 캐릭터와 틀린 ID는 거절한다", async () => {
    expect(await linkCharacter(admin(), NEW, "nope")).toEqual({ ok: false, reason: "없는 캐릭터" });
    expect(await linkCharacter(admin(), "a/b", CID)).toEqual({ ok: false, reason: "잘못된 요청" });
    expect(await linkCharacter(admin(), NEW, "a.b")).toEqual({ ok: false, reason: "잘못된 요청" });
  });
});

describe("화면 오류 기록", () => {
  const record = (uid: string) => ({ at: Date.now(), uid, message: "화면에서 난 오류" });
  it("로그인한 사람은 자기 오류를 덧붙이고, GM만 읽는다", async () => {
    await assertSucceeds(as(NEW).ref("errors/e1").set(record(NEW)));
    await assertFails(as(NEW).ref("errors/e1").get());
    await assertFails(as(NEW).ref("errors").get());
    await assertSucceeds(as(GM).ref("errors").get());
  });
  it("남의 이름으로 쓰거나, 고치거나 지우거나, 로그인 없이 쓸 수 없다", async () => {
    await assertFails(as(NEW).ref("errors/e1").set(record(OTHER)));
    await as(NEW).ref("errors/e2").set(record(NEW));
    await assertFails(as(NEW).ref("errors/e2/message").set("고침"));
    await assertFails(as(NEW).ref("errors/e2").remove());
    await assertFails(anon().ref("errors/e3").set(record("x")));
    await assertFails(as(NEW).ref("errors/e4").set({ ...record(NEW), message: "가".repeat(2001) }));
  });
});
