import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import {
  commitFishing,
  FISHING_FATIGUE,
  type FishingOutcome,
} from "../../src/data/fishing";
import { planCast } from "../../src/rules/fishing";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const spot = defs.fishing.spots[0]!;

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => void (await seed(testEnv, makeCharacter(OWNER))));

const db = () => testEnv.authenticatedContext(OWNER).database();
const port = (): DbPort => portOf(db());
const ctx = () => ({
  limits,
  items: defs.itemMap,
  now: Date.now(),
  carryLimit: 1000,
});
const fish = (
  requestId: string,
  outcome: FishingOutcome,
  castSeed = "s1",
  power = 0.9,
) =>
  commitFishing(
    port(),
    CID,
    requestId,
    { spotId: spot.id, seed: castSeed, power, outcome },
    defs.fishing,
    ctx(),
  );
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));
const good: FishingOutcome = { kind: "낚음", accuracy: 1, maxTension: 0.1 };

describe("낚시 저장", () => {
  it("낚으면 가방에(품질 포함), 피로 +1, 내 최고 기록. 같은 요청은 한 번", async () => {
    // 가짜 캐릭터의 달 514-3 = 넷째 달 = 여름
    const expected = planCast("s1", 0.9, spot, "여름", defs.fishing.rules);
    const result = await fish("f1", good);
    expect(result).toMatchObject({
      status: "ok",
      caught: {
        item: expected.fish.item,
        size: expected.size,
        quality: "최상",
        record: true,
      },
    });
    const c = await character();
    expect(Object.values(c.bag.stacks)).toEqual([
      expect.objectContaining({
        itemId: expected.fish.item,
        quantity: 1,
        quality: "최상",
      }),
    ]);
    expect(c.month.fatigue[FISHING_FATIGUE]).toBe(1);
    expect(c.records.fish[expected.fish.item.replaceAll(".", "_")]).toBe(
      expected.size,
    );
    expect(await readAll(testEnv, `requests/${CID}/f1`)).toMatchObject({
      kind: "낚시",
    });
    expect(await fish("f1", good)).toEqual({ status: "duplicate" });
  });

  it("놓쳐도 피로는 오른다, 가방은 그대로", async () => {
    expect(await fish("f1", { kind: "끊어짐" })).toEqual({
      status: "ok",
      mailed: [],
    });
    const c = await character();
    expect(c.month.fatigue[FISHING_FATIGUE]).toBe(1);
    expect(c.bag.stacks).toEqual({});
  });

  it("피로가 쌓이면 품질이 곡선 단계만큼 내려간다 (3번째 한 단계, 4번째 두 단계, 5번째 세 단계)", async () => {
    const qualities = [];
    for (let i = 1; i <= 5; i++) {
      const r = await fish(`f${i}`, good, `q${i}`, 0.1);
      if (r.status === "ok") qualities.push(r.caught?.quality);
    }
    expect(qualities).toEqual(["최상", "최상", "상", "중", "하"]);
  });

  it("최고 기록은 커질 때만 바뀌고, 주인이 직접 줄일 수 없다", async () => {
    // 같은 고기(얕은 곳 갈대피라미)를 여러 번: 가장 큰 크기만 남는다
    const sizes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fish(`m${i}`, good, `m${i}`, 0.05);
      if (r.status === "ok" && r.caught?.item === "reed-minnow")
        sizes.push(r.caught.size);
    }
    const c = await character();
    expect(c.records.fish["reed-minnow"]).toBe(Math.max(...sizes));
    await assertFails(
      db().ref(`characters/${CID}/records/fish/reed-minnow`).set(1),
    );
  });
});
