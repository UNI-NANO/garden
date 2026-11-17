import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitMonthAction } from "../../src/data/month-action";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { CID, CLOCK, OTHER, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

const port = (uid = OWNER): DbPort => portOf(testEnv.authenticatedContext(uid).database());
const act = (requestId: string, kind: "주 행동" | "작은 행동" = "주 행동", monthKey = "514-3", uid = OWNER) =>
  commitMonthAction(port(uid), CID, requestId, { monthKey, kind }, { limits, now: Date.now() });
const character = async () => characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

beforeEach(async () => {
  const c = makeCharacter(OWNER);
  c.month = { ...c.month, key: "514-3", mainActions: 4, minorActions: 2, savedActions: 1 };
  await seed(testEnv, c);
});

describe("달 행동 쓰기", () => {
  it("저장 행동부터 쓰고, 달 칸·수정 번호·요청 기록이 한 번에 쓰인다", async () => {
    expect(await act("a1")).toMatchObject({ status: "ok", used: { saved: 1, main: 0 } });
    expect(await act("a2")).toMatchObject({ status: "ok", used: { saved: 0, main: 1 } });
    const c = await character();
    expect([c.month.savedActions, c.month.mainActions, c.meta.rev, c.meta.lastRequestId]).toEqual([0, 3, 2, "a2"]);
    expect(await readAll(testEnv, `requests/${CID}/a2`)).toMatchObject({ kind: "달 행동" });
  });

  it("같은 요청은 한 번만, 동시에 와도", async () => {
    const [x, y] = await Promise.all([act("same"), act("same")]);
    expect([x.status, y.status].sort()).toEqual(["duplicate", "ok"]);
    expect(await act("same")).toEqual({ status: "duplicate" });
    expect((await character()).month.savedActions).toBe(0);
  });

  it("작은 행동은 따로, 다 쓰면 거절", async () => {
    await act("m1", "작은 행동");
    await act("m2", "작은 행동");
    expect(await act("m3", "작은 행동")).toEqual({ status: "rejected", reason: "행동이 없음" });
    expect((await character()).month.minorActions).toBe(0);
  });

  it("달이 바뀌기 직전에 보낸 요청, 계산 중, 이름 없는 다섯 날은 거절", async () => {
    expect(await act("old", "주 행동", "514-2")).toEqual({ status: "rejected", reason: "달이 다름" });
    await seed(testEnv, (await readAll(testEnv, `characters/${CID}`)) as object, { ...CLOCK, computing: true });
    expect(await act("busy")).toEqual({ status: "rejected", reason: "계산 중" });
    const c = makeCharacter(OWNER);
    c.month = { ...c.month, key: "514-11" };
    await seed(testEnv, c, { ...CLOCK, monthIndex: 11, monthKey: "514-11" });
    expect(await act("nameless", "주 행동", "514-11")).toEqual({ status: "rejected", reason: "이름 없는 다섯 날" });
  });

  it("남의 캐릭터에는 쓸 수 없다", async () => {
    // 남의 캐릭터는 읽을 수도 없다
    await expect(act("x", "주 행동", "514-3", OTHER)).rejects.toThrow(/Permission denied/i);
    expect((await character()).month.savedActions).toBe(1);
  });
});

describe("보안 규칙: 달 칸", () => {
  const db = (uid = OWNER) => testEnv.authenticatedContext(uid).database();
  /** 주인이 달 칸을 쓰는 한 번 (수정 번호 +1, 새 요청 기록과 함께) */
  const write = (month: Record<string, unknown>, rid = "w1", uid = OWNER) =>
    db(uid)
      .ref()
      .update({
        ...Object.fromEntries(Object.entries(month).map(([k, v]) => [`characters/${CID}/month/${k}`, v])),
        [`characters/${CID}/meta/rev`]: 1,
        [`characters/${CID}/meta/lastRequestId`]: rid,
        [`requests/${CID}/${rid}`]: { at: Date.now(), kind: "달 행동" },
      });

  it("주인은 행동을 줄이기만 한다: 다시 채우기, 달 키 바꾸기는 막힘", async () => {
    await assertFails(write({ mainActions: 5 }));
    await assertFails(write({ savedActions: 2 }));
    await assertFails(write({ minorActions: 2, mainActions: 4, savedActions: 1, key: "514-4" }));
    await assertSucceeds(write({ mainActions: 3 }));
  });

  it("이번 달 경력은 줄일 수 없다", async () => {
    const c = makeCharacter(OWNER);
    c.month = { ...c.month, key: "514-3", career: 1 };
    await seed(testEnv, c);
    await assertFails(write({ career: 0 }));
  });

  it("계산 중이거나 세계의 달과 다르면 막힘", async () => {
    await seed(testEnv, (await readAll(testEnv, `characters/${CID}`)) as object, { ...CLOCK, computing: true });
    await assertFails(write({ mainActions: 3 }));
    await seed(testEnv, (await readAll(testEnv, `characters/${CID}`)) as object, { ...CLOCK, monthIndex: 4, monthKey: "514-4" });
    await assertFails(write({ mainActions: 3 }));
  });

  it("세계 시계는 주인이 못 쓴다", async () => {
    await assertFails(db().ref("world/clock/computing").set(true));
    await assertSucceeds(db().ref("world/clock").get());
  });
});
