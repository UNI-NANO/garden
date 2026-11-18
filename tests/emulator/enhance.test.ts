import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitEnhance } from "../../src/data/enhance";
import { enhanceRoll } from "../../src/rules/enhance";
import { characterSchema, type Character } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const table = defs.enhance;

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

async function setup(
  enhance: number,
  extra: (c: Character) => void = () => undefined,
) {
  const c = makeCharacter(OWNER);
  c.wallet = 5000;
  c.bag.uniques = {
    sword1: {
      itemId: "knights-longsword",
      enhance,
      durability: 100,
      quality: "중",
    },
    ring: {
      itemId: "el-peso-del-padre",
      enhance: 0,
      durability: 100,
      quality: "중",
    },
  };
  c.bag.stacks = {
    i1: { itemId: "iron-scrap", quantity: 30, freshness: 100, quality: "중" },
    c1: { itemId: "chief-sinew", quantity: 10, freshness: 100, quality: "중" },
    o1: {
      itemId: "starlight-ore",
      quantity: 10,
      freshness: 100,
      quality: "중",
    },
    ch: { itemId: "smiths-charm", quantity: 1, freshness: 100, quality: "중" },
  };
  extra(c);
  await seed(testEnv, c);
}
beforeEach(async () => void (await setup(0)));

const port = (): DbPort =>
  portOf(testEnv.authenticatedContext(OWNER).database());
const ctx = () => ({
  limits,
  items: defs.itemMap,
  now: Date.now(),
  carryLimit: 1000,
});
const enhance = (requestId: string, useCharm = false, uniqueId = "sword1") =>
  commitEnhance(port(), CID, requestId, { uniqueId, useCharm }, table, ctx());
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));
/** 그 결과가 나오는 요청 ID */
const seedWhere = (
  current: number,
  want: (r: ReturnType<typeof enhanceRoll>) => boolean,
  charm = false,
) => {
  for (let s = 0; ; s++)
    if (want(enhanceRoll(`q${s}`, current, 0, charm, table))) return `q${s}`;
};

describe("강화 저장", () => {
  it("+1은 늘 성공: 돈 전부와 재료를 내고 단계가 오른다. 같은 요청은 한 번", async () => {
    const result = await enhance("e1");
    expect(result).toMatchObject({
      status: "ok",
      before: 0,
      roll: { success: true, level: 1 },
    });
    const c = await character();
    expect(c.bag.uniques["sword1"]).toMatchObject({
      enhance: 1,
      failStreak: 0,
    });
    expect(c.wallet).toBe(5000 - table.steps[0]!.money);
    expect(c.bag.stacks["i1"]?.quantity).toBe(29);
    expect(await readAll(testEnv, `requests/${CID}/e1`)).toMatchObject({
      kind: "강화",
    });
    expect(await enhance("e1")).toEqual({ status: "duplicate" });
  });

  it("실패하면 재료 전부와 돈 절반, 연속 실패 +1", async () => {
    await setup(4);
    const rid = seedWhere(4, (r) => !r.success);
    expect(await enhance(rid)).toMatchObject({
      status: "ok",
      roll: { success: false, level: 4 },
    });
    const c = await character();
    expect(c.wallet).toBe(5000 - Math.floor(table.steps[4]!.money / 2));
    expect(c.bag.stacks["i1"]?.quantity).toBe(30 - 5);
    expect(c.bag.uniques["sword1"]).toMatchObject({
      enhance: 4,
      failStreak: 1,
    });
  });

  it("+7부터 실패하면 내려갈 수 있고, 부적은 막을 때만 하나 쓴다", async () => {
    await setup(7);
    const rid = seedWhere(7, (r) => r.dropped);
    expect(await enhance(rid)).toMatchObject({
      status: "ok",
      roll: { dropped: true, level: 6 },
    });
    expect((await character()).bag.uniques["sword1"]?.enhance).toBe(6);
    await setup(7);
    expect(await enhance(rid, true)).toMatchObject({
      status: "ok",
      roll: { charmUsed: true, level: 7 },
    });
    const c = await character();
    expect(c.bag.uniques["sword1"]?.enhance).toBe(7);
    expect(c.bag.stacks["ch"]).toBeUndefined();
  });

  it("+10·강화할 수 없는 물건·모자란 돈은 거절, 아무것도 바뀌지 않는다", async () => {
    await setup(10);
    expect(await enhance("e1")).toEqual({
      status: "rejected",
      detail: "이미 +10이다",
    });
    expect(await enhance("e2", false, "ring")).toEqual({
      status: "rejected",
      detail: "강화할 수 없는 물건",
    });
    await setup(9, (c) => (c.wallet = 10));
    expect(await enhance("e3")).toEqual({
      status: "rejected",
      detail: "돈이 모자란다",
    });
    expect((await character()).meta.rev).toBe(0);
  });
});
