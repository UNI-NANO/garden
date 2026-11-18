import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commitDuel, registerBuild } from "../../src/data/arena";
import type { DbPort } from "../../src/data/commit";
import { paths } from "../../src/data/paths";
import { TRAINING_FATIGUE } from "../../src/data/training";
import { ArenaEntrySchema } from "../../src/schema/arena";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import {
  CID,
  OTHER,
  OWNER,
  portOf,
  readAll,
  seed,
  startTestEnv,
} from "./helpers";

const defs = realDefs();
const CID2 = "char-2";
const SEASON = "514-summer"; // 가짜 캐릭터의 달 514-3

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => {
  await seed(testEnv, makeCharacter(OWNER));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const other = makeCharacter(OTHER);
    other.profile.name = "메멜";
    await context
      .database()
      .ref()
      .update({
        [`characters/${CID2}`]: other,
        [`accounts/${OWNER}/characterId`]: CID,
        [`accounts/${OTHER}/characterId`]: CID2,
      });
  });
});

const portAs = (uid: string): DbPort =>
  portOf(testEnv.authenticatedContext(uid).database());
const ctx = () => ({ limits, now: Date.now() });
const register = (uid: string, cid: string, rid: string) =>
  registerBuild(portAs(uid), cid, rid, defs.trees, ctx());
const duel = (rid: string, won: boolean, opponent = CID2) =>
  commitDuel(portAs(OWNER), CID, rid, { opponent, won }, ctx());
const entry = async (cid: string) =>
  ArenaEntrySchema.parse(await readAll(testEnv, paths.arenaEntry(SEASON, cid)));
const fatigue = async () =>
  (await readAll(
    testEnv,
    `characters/${CID}/month/fatigue/${TRAINING_FATIGUE}`,
  )) as number | null;

describe("투기장 등록", () => {
  it("처음 등록하면 시작 점수, 다시 등록하면 빌드만 바뀌고 점수는 그대로", async () => {
    const first = await register(OWNER, CID, "r1");
    expect(first).toMatchObject({ status: "ok", season: SEASON });
    expect(await entry(CID)).toMatchObject({
      score: limits.arena.startScore,
      wins: 0,
      losses: 0,
    });
    await register(OTHER, CID2, "r2");
    await duel("d1", true);
    const scored = (await entry(CID)).score;
    await testEnv.withSecurityRulesDisabled((c) =>
      c.database().ref(`characters/${CID}/loadout/basics`).set(["sword.combo"]),
    );
    expect((await register(OWNER, CID, "r3")).status).toBe("ok");
    const after = await entry(CID);
    expect(after.score).toBe(scored);
    expect(after.wins).toBe(1);
    expect(after.build.basics).toEqual(["sword.combo"]);
    expect(await register(OWNER, CID, "r3")).toEqual({ status: "duplicate" });
  });
});

describe("결투 저장", () => {
  beforeEach(async () => {
    await register(OWNER, CID, "r1");
    await register(OTHER, CID2, "r2");
  });

  it("이기면 내 점수·승 +, 피로 +1, 상대 점수는 그대로이고 상대 기록에 한 줄. 같은 요청은 한 번", async () => {
    const result = await duel("d1", true);
    expect(result).toMatchObject({ status: "ok", delta: 16 });
    expect(await entry(CID)).toMatchObject({ score: 1016, wins: 1, losses: 0 });
    expect(await entry(CID2)).toMatchObject({
      score: 1000,
      wins: 0,
      losses: 0,
    });
    expect(await fatigue()).toBe(1);
    expect(
      await readAll(testEnv, paths.arenaLog(SEASON, CID2, "d1")),
    ).toMatchObject({ from: CID, challengerWon: true });
    expect(await duel("d1", true)).toEqual({ status: "duplicate" });
    expect((await entry(CID)).score).toBe(1016);
  });

  it("지면 점수가 내려가고 패 +1, 피로는 오른다", async () => {
    expect(await duel("d2", false)).toMatchObject({ status: "ok", delta: -16 });
    expect(await entry(CID)).toMatchObject({ score: 984, wins: 0, losses: 1 });
    expect(await fatigue()).toBe(1);
  });

  it("피로가 쌓이면 이길 때 얻는 점수가 줄어든다", async () => {
    for (let i = 0; i < 4; i++) await duel(`f${i}`, false);
    const result = await duel("f5", true);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.delta).toBeLessThan(16);
  });

  it("자기 자신·등록하지 않은 상대는 거절", async () => {
    expect((await duel("x1", true, CID)).status).toBe("rejected");
    expect((await duel("x2", true, "char-none")).status).toBe("rejected");
    expect(await fatigue()).toBeNull();
  });
});

describe("투기장 보안 규칙", () => {
  beforeEach(async () => {
    await register(OWNER, CID, "r1");
    await register(OTHER, CID2, "r2");
  });

  it("남의 칸은 고칠 수 없다", async () => {
    const db = portAs(OWNER);
    const res = await db.update({
      [paths.characterPart(CID, "meta/rev")]:
        ((await readAll(testEnv, `characters/${CID}/meta/rev`)) as number) + 1,
      [paths.characterPart(CID, "meta/lastRequestId")]: "h1",
      [paths.request(CID, "h1")]: { at: Date.now(), kind: "결투" },
      [`${paths.arenaEntry(SEASON, CID2)}/score`]: 0,
    });
    expect(res).toBe("denied");
  });

  it("점수를 한 번에 크게 올리거나, 결투 요청 없이 점수를 바꿀 수 없다", async () => {
    const db = portAs(OWNER);
    const rev = (await readAll(
      testEnv,
      `characters/${CID}/meta/rev`,
    )) as number;
    const attempt = (rid: string, kind: string, score: number, wins: number) =>
      db.update({
        [paths.characterPart(CID, "meta/rev")]: rev + 1,
        [paths.characterPart(CID, "meta/lastRequestId")]: rid,
        [paths.request(CID, rid)]: { at: Date.now(), kind },
        [`${paths.arenaEntry(SEASON, CID)}/score`]: score,
        [`${paths.arenaEntry(SEASON, CID)}/wins`]: wins,
      });
    expect(await attempt("h2", "결투", 1000 + limits.arena.k + 1, 1)).toBe(
      "denied",
    );
    expect(await attempt("h3", "투기장 등록", 1010, 0)).toBe("denied");
    expect(await attempt("h4", "결투", 1010, 2)).toBe("denied");
    expect(await attempt("h5", "결투", 1010, 1)).toBe("ok");
  });

  it("처음 칸은 시작 점수로만 만들 수 있다", async () => {
    await testEnv.withSecurityRulesDisabled((c) =>
      c.database().ref(paths.arenaEntry(SEASON, CID)).remove(),
    );
    const db = portAs(OWNER);
    const rev = (await readAll(
      testEnv,
      `characters/${CID}/meta/rev`,
    )) as number;
    const e = await entry(CID2);
    const res = await db.update({
      [paths.characterPart(CID, "meta/rev")]: rev + 1,
      [paths.characterPart(CID, "meta/lastRequestId")]: "h6",
      [paths.request(CID, "h6")]: { at: Date.now(), kind: "투기장 등록" },
      [paths.arenaEntry(SEASON, CID)]: { ...e, score: 1500 },
    });
    expect(res).toBe("denied");
  });

  it("상대 기록은 결투 요청과 같은 쓰기에서만, 내 이름으로만", async () => {
    const db = portAs(OWNER);
    expect(
      await db.update({
        [paths.arenaLog(SEASON, CID2, "z1")]: {
          at: Date.now(),
          from: CID,
          fromName: "x",
          challengerWon: true,
        },
      }),
    ).toBe("denied");
    // 순위표는 다른 사람도 읽을 수 있다
    expect(
      await portAs(OTHER).get(paths.arenaEntry(SEASON, CID)),
    ).not.toBeNull();
  });
});
