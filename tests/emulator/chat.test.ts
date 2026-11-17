import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupChat, sendChat, type Speaker } from "../../src/data/chat";
import type { DbPort } from "../../src/data/commit";
import { LIBRARY_ZONE, zoneKeyOf } from "../../src/rules/chat";
import { limits, makeCharacter } from "../helpers/fake-character";
import { GM, OTHER, OWNER, portOf, readAll, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

const FAR = "uid-far";
const INN = { region: "황도", place: "여관" };
const INN_ZONE = zoneKeyOf(INN);

/** 도서관에 둘(OWNER·OTHER), 황도 여관에 하나(FAR) */
beforeEach(async () => {
  const far = makeCharacter(FAR);
  far.profile = { ...far.profile, location: { ...INN, zone: INN_ZONE } };
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set({
      gm: { [GM]: true },
      characters: { "c-a": makeCharacter(OWNER), "c-b": makeCharacter(OTHER), "c-far": far },
      accounts: { [OWNER]: { characterId: "c-a" }, [OTHER]: { characterId: "c-b" }, [FAR]: { characterId: "c-far" } },
    });
  });
});

const db = (uid: string) => testEnv.authenticatedContext(uid).database();
const port = (uid: string): DbPort => portOf(db(uid));
const me = (uid: string, cid: string, zone = LIBRARY_ZONE): Speaker => ({ uid, cid, name: cid, zone });
let clock = Date.now();
/** 간격 규칙(0.5초)을 넘기도록 시각을 1초씩 늘린다 */
const tick = () => (clock = Math.max(clock + 1000, Date.now()));
const say = (uid: string, cid: string, text: string, id: string, zone = LIBRARY_ZONE) =>
  sendChat(port(uid), me(uid, cid, zone), { kind: "말", text }, { now: tick(), id });

describe("구역 대화", () => {
  it("같은 구역 사람만 읽고 쓴다", async () => {
    expect(await say(OWNER, "c-a", "안녕", "m1")).toBe("ok");
    await assertSucceeds(db(OTHER).ref(`chat/${LIBRARY_ZONE}`).get());
    await assertFails(db(FAR).ref(`chat/${LIBRARY_ZONE}`).get());
    expect(await say(FAR, "c-far", "끼어들기", "m2")).toBe("denied");
    expect(await say(FAR, "c-far", "여관에서", "m3", INN_ZONE)).toBe("ok");
    await assertFails(db(OWNER).ref(`chat/${INN_ZONE}`).get());
    await assertSucceeds(db(GM).ref(`chat/${INN_ZONE}`).get());
  });

  it("남긴 말은 고치거나 지울 수 없고, 남의 이름으로 쓸 수 없다", async () => {
    await say(OWNER, "c-a", "원래 말", "m1");
    await assertFails(db(OWNER).ref(`chat/${LIBRARY_ZONE}/m1/text`).set("고친 말"));
    await assertFails(db(OWNER).ref(`chat/${LIBRARY_ZONE}/m1`).remove());
    expect(await sendChat(port(OWNER), me(OWNER, "c-b"), { kind: "말", text: "사칭" }, { now: tick(), id: "m2" })).toBe("denied");
  });

  it("길이·종류를 지키고, 앞 줄과 0.5초 간격", async () => {
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), { kind: "말", text: "가".repeat(201) }, { now: tick(), id: "m1" })).toBe("denied");
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), { kind: "표정", text: "웃음" }, { now: tick(), id: "m2" })).toBe("ok");
    const at = tick();
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), { kind: "말", text: "하나" }, { now: at, id: "m3" })).toBe("ok");
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), { kind: "말", text: "둘" }, { now: at + 100, id: "m4" })).toBe("denied");
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), { kind: "말", text: "셋" }, { now: at + 600, id: "m5" })).toBe("ok");
  });

  it("귓속말: 같은 구역의 한 사람에게, 받는 사람과 보낸 사람만 읽는다", async () => {
    const out = { kind: "귓속말", to: "c-b", text: "몰래" } as const;
    expect(await sendChat(port(OWNER), me(OWNER, "c-a"), out, { now: tick(), id: "w1", to: { cid: "c-b", name: "c-b" } })).toBe("ok");
    expect(await readAll(testEnv, "whispers/c-b/w1")).toMatchObject({ text: "몰래", to: "c-b", cid: "c-a" });
    expect(await readAll(testEnv, "whispers/c-a/w1")).toMatchObject({ text: "몰래" });
    await assertSucceeds(db(OTHER).ref("whispers/c-b").get());
    await assertFails(db(OTHER).ref("whispers/c-a").get());
    await assertFails(db(FAR).ref("whispers/c-b").get());
    // 다른 구역의 사람에게는 못 보낸다
    expect(await sendChat(port(FAR), me(FAR, "c-far", INN_ZONE), { ...out }, { now: tick(), id: "w2", to: { cid: "c-b", name: "c-b" } })).toBe("denied");
  });

  it("말 막기 동안은 쓸 수 없다 (막기는 GM만)", async () => {
    await assertFails(db(OWNER).ref("chatMutes/c-b").set(Date.now() + 60_000));
    await assertSucceeds(db(GM).ref("chatMutes/c-a").set(Date.now() + 60_000));
    expect(await say(OWNER, "c-a", "막혔나", "m1")).toBe("denied");
    await assertSucceeds(db(GM).ref("chatMutes/c-a").set(Date.now() - 1));
    expect(await say(OWNER, "c-a", "풀렸다", "m2")).toBe("ok");
  });

  it("신고는 누구나 남기고 GM만 읽는다", async () => {
    const report = { at: Date.now(), by: OTHER, zone: LIBRARY_ZONE, line: "m1", text: "나쁜 말" };
    await assertSucceeds(db(OTHER).ref("chatReports/r1").set(report));
    await assertFails(db(OTHER).ref("chatReports/r2").set({ ...report, by: OWNER }));
    await assertFails(db(OTHER).ref("chatReports").get());
    await assertSucceeds(db(GM).ref("chatReports").get());
  });

  it("하루 계산의 정리: 7일 지난 대화·귓속말을 지운다 (두 번 돌아도 같다)", async () => {
    const now = Date.now();
    const old = now - 8 * 86_400_000;
    const line = (at: number) => ({ at, uid: OWNER, cid: "c-a", name: "a", kind: "말", text: "x" });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context
        .database()
        .ref()
        .update({ [`chat/${LIBRARY_ZONE}/old`]: line(old), [`chat/${LIBRARY_ZONE}/new`]: line(now), "whispers/c-b/old": { ...line(old), to: "c-b", toName: "b" } });
    });
    const admin = {
      get: (path: string) => readAll(testEnv, path),
      update: async (updates: Record<string, unknown>) => {
        await testEnv.withSecurityRulesDisabled(async (context) => void (await context.database().ref().update(updates)));
      },
    };
    expect(await cleanupChat(admin, limits, now)).toBe(2);
    expect(await cleanupChat(admin, limits, now)).toBe(0);
    expect(Object.keys((await readAll(testEnv, `chat/${LIBRARY_ZONE}`)) as object)).toEqual(["new"]);
  });
});
