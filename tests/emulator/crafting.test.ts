import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitCombine, commitCraft } from "../../src/data/crafting";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => {
  const c = makeCharacter(OWNER);
  c.bag.stacks = {
    m1: {
      itemId: "hill-mugwort",
      quantity: 5,
      freshness: 100,
      quality: "최상",
    },
    b1: {
      itemId: "bloodstop-herb",
      quantity: 3,
      freshness: 100,
      quality: "최상",
    },
    s1: {
      itemId: "silver-willow-leaf",
      quantity: 2,
      freshness: 100,
      quality: "중",
    },
    t1: { itemId: "timber", quantity: 1, freshness: 100, quality: "중" },
    k1: { itemId: "boar-tusk", quantity: 2, freshness: 100, quality: "상" },
  };
  c.pendingResults = [
    { scene: "s", cmd: "레시피", args: ["고기_꼬치"] },
    { scene: "s", cmd: "칭호", args: ["누군가"] },
  ];
  await seed(testEnv, c);
});

const db = () => testEnv.authenticatedContext(OWNER).database();
const port = (): DbPort => portOf(db());
const ctx = () => ({
  limits,
  items: defs.itemMap,
  now: Date.now(),
  carryLimit: 1000,
});
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

describe("제작 저장", () => {
  it("기본 레시피로 만들면 재료를 빼고 결과를 넣는다(품질은 판정·재료). 같은 요청은 한 번. 보류된 [레시피]도 배운다", async () => {
    const result = await commitCraft(
      port(),
      CID,
      "c1",
      { recipeId: "hemostatic-salve", judgements: ["완벽", "완벽", "완벽"] },
      defs.crafting,
      ctx(),
    );
    expect(result).toMatchObject({ status: "ok", quality: "최상" });
    const c = await character();
    expect(c.bag.stacks["b1"]?.quantity).toBe(1);
    expect(c.bag.stacks["m1"]?.quantity).toBe(4);
    expect(
      Object.values(c.bag.stacks).find((s) => s.itemId === "hemostatic-salve"),
    ).toMatchObject({ quantity: 1, quality: "최상" });
    expect(c.recipes["meat-skewer"]).toBe(true);
    expect(c.pendingResults).toEqual([
      { scene: "s", cmd: "칭호", args: ["누군가"] },
    ]);
    expect(await readAll(testEnv, `requests/${CID}/c1`)).toMatchObject({
      kind: "제작",
    });
    expect(
      await commitCraft(
        port(),
        CID,
        "c1",
        { recipeId: "hemostatic-salve", judgements: ["완벽", "완벽", "완벽"] },
        defs.crafting,
        ctx(),
      ),
    ).toEqual({ status: "duplicate" });
  });

  it("낱개 결과(사냥꾼의 손칼)는 고유 ID로, 판정이 나쁘면 품질이 낮다", async () => {
    const result = await commitCraft(
      port(),
      CID,
      "c1",
      { recipeId: "hunters-knife", judgements: ["빗나감", "빗나감", "보통"] },
      defs.crafting,
      ctx(),
    );
    expect(result).toMatchObject({ status: "ok", quality: "하" });
    const c = await character();
    expect(c.bag.uniques["c1-0"]).toMatchObject({
      itemId: "hunters-knife",
      enhance: 0,
      quality: "하",
    });
  });

  it("모르는 레시피·모자란 재료·판정 수가 틀리면 거절, 아무것도 바뀌지 않는다", async () => {
    expect(
      await commitCraft(
        port(),
        CID,
        "c1",
        { recipeId: "leather-bracer", judgements: ["완벽", "완벽", "완벽"] },
        defs.crafting,
        ctx(),
      ),
    ).toEqual({ status: "rejected", detail: "모르는 레시피" });
    expect(
      await commitCraft(
        port(),
        CID,
        "c2",
        { recipeId: "grilled-fish", judgements: ["완벽", "완벽"] },
        defs.crafting,
        ctx(),
      ),
    ).toEqual({ status: "rejected", detail: "재료가 모자란다: marsh-crucian" });
    expect(
      (
        await commitCraft(
          port(),
          CID,
          "c3",
          { recipeId: "hemostatic-salve", judgements: ["완벽"] },
          defs.crafting,
          ctx(),
        )
      ).status,
    ).toBe("rejected");
    expect((await character()).meta.rev).toBe(0);
  });

  it("조합 시도: 맞으면 배우고 재료는 그대로, 틀리면 종류마다 절반을 잃는다", async () => {
    const learn = await commitCombine(
      port(),
      CID,
      "k1",
      {
        stationId: "apothecary",
        inputs: [
          { item: "silver-willow-leaf", quantity: 1 },
          { item: "hill-mugwort", quantity: 1 },
        ],
      },
      defs.crafting,
      ctx(),
    );
    expect(learn).toMatchObject({ status: "ok", learned: "detox-poultice" });
    let c = await character();
    expect(c.recipes["detox-poultice"]).toBe(true);
    expect(c.bag.stacks["s1"]?.quantity).toBe(2);
    const fail = await commitCombine(
      port(),
      CID,
      "k2",
      {
        stationId: "kitchen",
        inputs: [
          { item: "hill-mugwort", quantity: 4 },
          { item: "timber", quantity: 1 },
        ],
      },
      defs.crafting,
      ctx(),
    );
    expect(fail).toMatchObject({
      status: "ok",
      lost: [
        { item: "hill-mugwort", quantity: 2 },
        { item: "timber", quantity: 1 },
      ],
    });
    c = await character();
    expect(c.bag.stacks["m1"]?.quantity).toBe(3);
    expect(c.bag.stacks["t1"]).toBeUndefined();
    expect(
      await commitCombine(
        port(),
        CID,
        "k3",
        {
          stationId: "apothecary",
          inputs: [
            { item: "silver-willow-leaf", quantity: 1 },
            { item: "hill-mugwort", quantity: 1 },
          ],
        },
        defs.crafting,
        ctx(),
      ),
    ).toEqual({ status: "rejected", detail: "이미 아는 레시피: 해독 찜질" });
  });

  it("배운 레시피는 주인이 지울 수 없다", async () => {
    await commitCombine(
      port(),
      CID,
      "k1",
      {
        stationId: "apothecary",
        inputs: [
          { item: "silver-willow-leaf", quantity: 1 },
          { item: "hill-mugwort", quantity: 1 },
        ],
      },
      defs.crafting,
      ctx(),
    );
    await assertFails(
      db().ref(`characters/${CID}/recipes/detox-poultice`).remove(),
    );
  });
});
