import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitGathering, GATHERING_FATIGUE } from "../../src/data/gathering";
import { planField, type GatherAction } from "../../src/rules/gathering";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const spot = defs.gathering.spots[0]!;
const { rules } = defs.gathering;

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
const gather = (
  requestId: string,
  fieldSeed: string,
  actions: GatherAction[],
) =>
  commitGathering(
    port(),
    CID,
    requestId,
    { spotId: spot.id, seed: fieldSeed, actions },
    defs.gathering,
    ctx(),
  );
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

/** 가짜 캐릭터의 달 514-3 = 여름. 약초와 독초가 다 있는 비탈 */
const fieldSeed = (() => {
  for (let s = 0; ; s++) {
    const f = planField(`e${s}`, spot, "여름", rules);
    if (f.plants.some((p) => p.poison) && f.plants.some((p) => !p.poison))
      return `e${s}`;
  }
})();
const field = planField(fieldSeed, spot, "여름", rules);
const herb = field.plants.find((p) => !p.poison)!;
const poison = field.plants.find((p) => p.poison)!;

describe("채집 저장", () => {
  it("행동을 다시 돌려 캔 약초를 가방에(품질 포함), 피로 +1. 같은 요청은 한 번", async () => {
    const actions: GatherAction[] = [
      { plant: herb.index, kind: "잎 뒤 보기" },
      { plant: herb.index, kind: "조심히 캐기" },
      { plant: poison.index, kind: "빨리 뜯기" },
    ];
    const result = await gather("g1", fieldSeed, actions);
    expect(result.status).toBe("ok");
    if (result.status === "ok")
      expect(result.result.wasted).toEqual([poison.index]);
    const c = await character();
    expect(Object.values(c.bag.stacks)).toEqual([
      expect.objectContaining({
        itemId: herb.herb.item,
        quantity: herb.quantity,
        quality: "최상",
      }),
    ]);
    expect(c.month.fatigue[GATHERING_FATIGUE]).toBe(1);
    expect(await readAll(testEnv, `requests/${CID}/g1`)).toMatchObject({
      kind: "채집",
    });
    expect(await gather("g1", fieldSeed, actions)).toEqual({
      status: "duplicate",
    });
  });

  it("아무것도 못 캐도 피로는 오른다", async () => {
    expect((await gather("g1", fieldSeed, [])).status).toBe("ok");
    const c = await character();
    expect(c.month.fatigue[GATHERING_FATIGUE]).toBe(1);
    expect(c.bag.stacks).toEqual({});
  });

  it("할 수 없는 행동(같은 풀 두 번)이 섞이면 아무것도 저장하지 않는다", async () => {
    const result = await gather("g1", fieldSeed, [
      { plant: herb.index, kind: "빨리 뜯기" },
      { plant: herb.index, kind: "빨리 뜯기" },
    ]);
    expect(result).toEqual({ status: "rejected", detail: "이미 캔 풀" });
    const c = await character();
    expect(c.month.fatigue[GATHERING_FATIGUE]).toBeUndefined();
    expect(c.meta.rev).toBe(0);
  });
});
