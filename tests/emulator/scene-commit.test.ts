import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitScene } from "../../src/data/scene-commit";
import type { Result } from "../../src/rules/scene/parse";
import { characterSchema } from "../../src/schema/character";
import { ctx, limits, makeCharacter } from "../helpers/fake-character";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => {
  const c = makeCharacter(OWNER);
  c.wallet = 10;
  c.abilities = { ...c.abilities, reputation: 98 };
  c.people = { p0: { name: "에다", relation: "영매", intimacy: 5, note: "" } };
  c.profile = { ...c.profile, marks: ["이미_있던_표시"] };
  await seed(testEnv, c);
});

const port = (): DbPort => portOf(testEnv.authenticatedContext(OWNER).database());
const r = (cmd: Result["cmd"], ...args: string[]): Result => ({ cmd, args });
const RESULTS: Result[] = [
  r("표시", "새_책장을_봄"),
  r("단서", "등불을_든_노인"),
  r("친밀도", "에다", "+10"),
  r("친밀도", "마르타", "+3"),
  r("인물", "{친구}", "소꿉친구"),
  r("퀘스트", "가문_1막", "진행"),
  r("퀘스트", "가문_1막", "진행"),
  r("평판", "+5"),
  r("능력치", "건강", "-2"),
  r("주기", "잎전", "100"),
  r("주기", "약초", "2"),
  r("주기", "도서관_열람증", "1"),
  r("칭호", "시청의_서기"),
];
const commit = (requestId: string, sceneId = "intro_new_shelf", results = RESULTS) =>
  commitScene(port(), CID, requestId, { id: sceneId, results, choices: ["무슨 소란이었는데요?"] }, {
    ...ctx({ now: Date.now(), carryLimit: 100 }),
    resolve: (text) => text.replace("{친구}", "벤"),
  });
const character = async () => characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

describe("장면 결과 저장", () => {
  it("끝날 때 한 번에: 표시·단서·친밀도·인물·퀘스트·능력치·잎전·물건, 자리가 없는 것은 보류", async () => {
    const result = await commit("s1");
    expect(result.status).toBe("ok");
    const c = await character();
    expect(c.profile.marks).toEqual(["이미_있던_표시", "새_책장을_봄"]);
    expect(c.clues).toEqual(["등불을_든_노인"]);
    expect(Object.values(c.people).map((p) => [p.name, p.relation, p.intimacy])).toEqual([
      ["에다", "영매", 15],
      ["마르타", "", 3],
      ["벤", "소꿉친구", 0],
    ]);
    expect(c.quests).toEqual([{ id: "가문_1막", state: "진행", steps: 2 }]);
    // 평판은 최대 100에서 멈춘다
    expect([c.abilities.reputation, c.abilities.health]).toEqual([100, makeCharacter(OWNER).abilities.health - 2]);
    expect(c.wallet).toBe(110);
    expect(Object.values(c.bag.stacks)).toEqual([expect.objectContaining({ itemId: "herb", quantity: 2 })]);
    expect(c.pendingResults).toEqual([
      { scene: "intro_new_shelf", cmd: "주기", args: ["도서관_열람증", "1"] },
      { scene: "intro_new_shelf", cmd: "칭호", args: ["시청의_서기"] },
    ]);
    expect(c.scenes["intro_new_shelf"]).toMatchObject({ choices: ["무슨 소란이었는데요?"] });
    expect(c.claimedRewards["scene_intro_new_shelf"]).toBe(true);
    expect(c.meta.rev).toBe(1);
    expect(await readAll(testEnv, `requests/${CID}/s1`)).toMatchObject({ kind: "장면" });
    expect(await readAll(testEnv, `ledger/${CID}/s1`)).toMatchObject({ walletDelta: 100, reason: "장면 intro_new_shelf" });
    if (result.status === "ok") expect(result.summary).toContain("잎전 +100");
  });

  it("이미 본 장면은 다시 봐도 결과가 다시 들어가지 않는다, 같은 요청은 한 번만", async () => {
    await commit("s1");
    expect(await commit("s2")).toEqual({ status: "seen" });
    expect(await commit("s1")).toEqual({ status: "duplicate" });
    const c = await character();
    expect([c.wallet, c.meta.rev, c.quests[0]?.steps]).toEqual([110, 1, 2]);
  });

  it("돈·물건이 없는 장면은 장부 없이", async () => {
    expect((await commit("s3", "guide_hwangdo_start", [r("표시", "x")])).status).toBe("ok");
    expect(await readAll(testEnv, `ledger/${CID}/s3`)).toBeNull();
    expect((await character()).profile.marks).toContain("x");
  });

  it("본 장면 기록은 주인이 지울 수 없다 (지우면 결과를 또 받을 수 있으므로)", async () => {
    await commit("s1");
    const db = testEnv.authenticatedContext(OWNER).database();
    await assertFails(
      db.ref().update({
        [`characters/${CID}/scenes/intro_new_shelf`]: null,
        [`characters/${CID}/meta/rev`]: 2,
        [`characters/${CID}/meta/lastRequestId`]: "del",
        [`requests/${CID}/del`]: { at: Date.now(), kind: "장면" },
      }),
    );
  });
});
