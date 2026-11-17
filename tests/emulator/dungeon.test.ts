import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { enterDungeon, EXPLORE_FATIGUE, finishExpedition, readExpedition, saveExpedition } from "../../src/data/dungeon";
import type { Expedition } from "../../src/rules/dungeon/explore";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OTHER, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const forest = defs.dungeons.find((d) => d.id === "border-forest")!;
const dungeons = new Map(defs.dungeons.map((d) => [d.id, d]));

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => {
  const c = makeCharacter(OWNER);
  c.wallet = 10;
  await seed(testEnv, c);
});

const db = (uid = OWNER) => testEnv.authenticatedContext(uid).database();
const port = (uid = OWNER): DbPort => portOf(db(uid));
const ctx = (now = Date.now()) => ({ limits, items: defs.itemMap, now, carryLimit: 1000 });
const enter = (requestId = "e1", now = Date.now()) => enterDungeon(port(), CID, requestId, { dungeon: forest, seed: requestId, maxHp: 100, maxEnergy: 6 }, ctx(now));
const finish = (requestId: string, now = Date.now()) => finishExpedition(port(), CID, requestId, dungeons, ctx(now));
const character = async () => characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));
/** 저장된 탐험을 바꿔 다시 저장한다 (진행 저장 규칙을 지나서) */
async function edit(change: (state: Expedition) => Expedition) {
  const found = (await readExpedition(port(), CID))!;
  expect(await saveExpedition(port(), CID, found.id, change(found.state))).toBe("ok");
}

describe("던전 저장", () => {
  it("들어가기: 탐험 기록과 피로 +1을 한 번에, 탐험 중에는 또 못 들어감, 같은 요청은 한 번", async () => {
    const result = await enter("e1");
    expect(result.status).toBe("ok");
    const c = await character();
    expect(c.expedition).toMatchObject({ id: "e1", dungeonId: "border-forest", floor: 1, fatigueIndex: 1, status: "탐험" });
    expect(c.month.fatigue[EXPLORE_FATIGUE]).toBe(1);
    expect(c.meta.rev).toBe(1);
    expect(await readAll(testEnv, `requests/${CID}/e1`)).toMatchObject({ kind: "던전" });
    expect(await enter("e1")).toEqual({ status: "duplicate" });
    expect(await enter("e2")).toEqual({ status: "rejected", detail: "이미 탐험 중이다" });
  });

  it("진행 저장은 같은 탐험만, 주인만. 기록을 그냥 지우거나 피로를 내릴 수 없다", async () => {
    await enter("e1");
    await edit((s) => ({ ...s, pressure: 3, gains: [{ kind: "잎전", quantity: 5 }] }));
    expect((await readExpedition(port(), CID))?.state).toMatchObject({ pressure: 3, gains: [{ kind: "잎전", quantity: 5 }] });
    const stored = await readAll(testEnv, `characters/${CID}/expedition`);
    await assertFails(db().ref(`characters/${CID}/expedition`).set({ ...(stored as object), id: "other" }));
    await assertFails(db().ref(`characters/${CID}/expedition`).set({ ...(stored as object), seed: "other" }));
    await assertFails(db(OTHER).ref(`characters/${CID}/expedition`).set(stored));
    await assertFails(db().ref(`characters/${CID}/expedition`).remove());
    await assertFails(db().ref(`characters/${CID}/month/fatigue/${EXPLORE_FATIGUE}`).set(0));
    await assertSucceeds(db().ref(`characters/${CID}/expedition/pressure`).set(4));
  });

  it("귀환: 얻은 것을 전부 가방·지갑에, 탐험 기록을 지우고 일생에 한 줄. 아직 탐험 중이면 거절", async () => {
    await enter("e1");
    await edit((s) => ({ ...s, gains: [{ kind: "잎전", quantity: 30 }, { kind: "묶음", item: "wolf-pelt", quantity: 3 }, { kind: "낱개", item: "hunters-knife" }] }));
    expect(await finish("f0")).toEqual({ status: "rejected", detail: "아직 탐험 중이다" });
    await edit((s) => ({ ...s, status: "귀환" }));
    const result = await finish("f1");
    expect(result.status).toBe("ok");
    const c = await character();
    expect(c.expedition).toBeUndefined();
    expect(c.wallet).toBe(40);
    expect(Object.values(c.bag.stacks)).toEqual([expect.objectContaining({ itemId: "wolf-pelt", quantity: 3 })]);
    expect(Object.values(c.bag.uniques)).toEqual([expect.objectContaining({ itemId: "hunters-knife" })]);
    expect(c.life.at(-1)).toMatchObject({ kind: "던전", text: "국경 숲길 1층: 쉼터에서 귀환" });
    expect(await readAll(testEnv, `ledger/${CID}/f1`)).toMatchObject({ walletDelta: 30, reason: "던전 국경 숲길" });
    expect(await finish("f1")).toEqual({ status: "duplicate" });
    expect(await finish("f2")).toEqual({ status: "none" });
    // 끝나면 다시 들어갈 수 있고, 피로는 2번째
    expect((await enter("e2")).status).toBe("ok");
    expect((await character()).expedition?.fatigueIndex).toBe(2);
  });

  it("전멸: 절반을 잃는다", async () => {
    await enter("e1");
    await edit((s) => ({ ...s, status: "전멸", gains: [{ kind: "잎전", quantity: 31 }, { kind: "묶음", item: "wolf-pelt", quantity: 5 }] }));
    const result = await finish("f1");
    expect(result.status).toBe("ok");
    const c = await character();
    expect(c.wallet).toBe(10 + 16);
    expect(Object.values(c.bag.stacks)).toEqual([expect.objectContaining({ itemId: "wolf-pelt", quantity: 3 })]);
    expect(c.life.at(-1)?.text).toContain("얻은 것의 절반을 잃음");
  });

  it("보스: 첫 클리어 보상은 한 번만", async () => {
    await enter("e1");
    await edit((s) => ({ ...s, status: "보스", floor: 3 }));
    const first = await finish("f1");
    expect(first).toMatchObject({ status: "ok", firstClear: true });
    expect((await character()).wallet).toBe(10 + 200);
    await enter("e2");
    await edit((s) => ({ ...s, status: "보스", floor: 3 }));
    expect(await finish("f2")).toMatchObject({ status: "ok", firstClear: false });
    const c = await character();
    expect(c.wallet).toBe(210);
    expect(Object.values(c.bag.uniques).filter((u) => u.itemId === "wolf-king-fang")).toHaveLength(1);
  });

  it("하루가 지나면 자동 귀환 (전부)", async () => {
    const start = Date.now() - limits.dungeon.autoReturnHours * 3_600_000 - 1000;
    await enter("e1", start);
    await edit((s) => ({ ...s, gains: [{ kind: "잎전", quantity: 7 }] }));
    expect((await finish("f1")).status).toBe("ok");
    const c = await character();
    expect(c.wallet).toBe(17);
    expect(c.life.at(-1)?.text).toContain("자동 귀환");
  });
});
