import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { paths } from "../../src/data/paths";
import { commitRaid, RAID_FATIGUE } from "../../src/data/raid";
import { raidWeek, type Contribution } from "../../src/rules/raid";
import { characterSchema } from "../../src/schema/character";
import { RaidRecordSchema } from "../../src/schema/raid";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const w = defs.raids.contribution;

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => void (await seed(testEnv, makeCharacter(OWNER))));

const port = (): DbPort =>
  portOf(testEnv.authenticatedContext(OWNER).database());
const ctx = () => ({
  limits,
  items: defs.itemMap,
  now: Date.now(),
  carryLimit: 1000,
});
const score = (
  damage: number,
  stagger = 0,
  prevented = 0,
  reactions = 0,
): Contribution => ({
  damage,
  stagger,
  prevented,
  reactions,
  score: Math.round(
    damage +
      stagger * w.stagger +
      prevented * w.prevented +
      reactions * w.reaction,
  ),
});
const week = () => raidWeek(Date.now(), defs.raids, limits);
const raid = (
  rid: string,
  won: boolean,
  c: Contribution,
  weekKey = week().key,
) =>
  commitRaid(
    port(),
    CID,
    rid,
    { weekKey, bossId: week().boss.id, won, contribution: c },
    defs.raids,
    ctx(),
  );
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));
const record = async () => {
  const raw = await readAll(testEnv, paths.raidRecord(week().key, CID));
  return raw == null ? undefined : RaidRecordSchema.parse(raw);
};

describe("반복 레이드 저장", () => {
  it("처음 이기면 주간 보상·일생·피로 +1·기여 기록. 같은 요청은 한 번", async () => {
    const before = await character();
    const result = await raid("r1", true, score(100, 10, 5, 1));
    expect(result).toMatchObject({ status: "ok", weekly: true, record: true });
    const c = await character();
    const money = week().boss.weekly.find((r) => r.kind === "잎전");
    expect(c.wallet).toBe(before.wallet + (money?.quantity ?? 0));
    expect(c.month.fatigue[RAID_FATIGUE]).toBe(1);
    expect(c.life.at(-1)?.text).toBe(`반복 레이드 — ${week().boss.name} 토벌`);
    expect((await record())?.score).toBe(score(100, 10, 5, 1).score);
    expect(await raid("r1", true, score(100))).toEqual({ status: "duplicate" });
  });

  it("두 번째 승리는 일반 보상(주간 보상 없음), 지면 피로만", async () => {
    await raid("r1", true, score(100));
    const before = await character();
    const second = await raid("r2", true, score(50));
    expect(second).toMatchObject({
      status: "ok",
      weekly: false,
      record: false,
    });
    const c = await character();
    expect(c.wallet).toBe(before.wallet);
    expect(c.life).toHaveLength(before.life.length);
    expect(c.month.fatigue[RAID_FATIGUE]).toBe(2);
    expect(await raid("r3", false, score(10))).toMatchObject({
      status: "ok",
      weekly: false,
      gains: [],
    });
    expect((await character()).month.fatigue[RAID_FATIGUE]).toBe(3);
  });

  it("기여 기록은 더 높을 때만 바꿔 쓴다 (더하지 않음)", async () => {
    await raid("r1", false, score(80));
    await raid("r2", false, score(40));
    expect((await record())?.score).toBe(80);
    expect(await raid("r3", false, score(120))).toMatchObject({ record: true });
    expect((await record())?.score).toBe(120);
  });

  it("지난 주의 판, 맞지 않는 기여 점수는 거절하고 아무것도 쓰지 않는다", async () => {
    expect(
      (await raid("x1", true, score(10), `w${week().index - 1}`)).status,
    ).toBe("rejected");
    expect((await raid("x2", true, { ...score(10), score: 9999 })).status).toBe(
      "rejected",
    );
    expect((await character()).month.fatigue[RAID_FATIGUE]).toBeUndefined();
  });
});

describe("반복 레이드 보안 규칙", () => {
  it("기여 기록은 「레이드」 요청과 같은 쓰기에서만, 점수는 커질 때만", async () => {
    await raid("r1", false, score(100));
    const db = port();
    const rec = (await record())!;
    const attempt = async (rid: string, kind: string, s: number) => {
      const rev = (await readAll(
        testEnv,
        `characters/${CID}/meta/rev`,
      )) as number;
      return db.update({
        [paths.characterPart(CID, "meta/rev")]: rev + 1,
        [paths.characterPart(CID, "meta/lastRequestId")]: rid,
        [paths.request(CID, rid)]: { at: Date.now(), kind },
        [paths.raidRecord(week().key, CID)]: { ...rec, score: s },
      });
    };
    expect(await attempt("h1", "레이드", 50)).toBe("denied");
    expect(await attempt("h2", "결투", 500)).toBe("denied");
    expect(await attempt("h3", "레이드", 500)).toBe("ok");
    // 남의 칸은 쓸 수 없다
    expect(
      await db.update({ [paths.raidRecord(week().key, "char-x")]: rec }),
    ).toBe("denied");
  });
});
