import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitHunting, HUNTING_FATIGUE } from "../../src/data/hunting";
import { barZones } from "../../src/rules/battle/judge";
import {
  BAR_LENGTH,
  barWidths,
  planHunt,
  type HuntAction,
} from "../../src/rules/hunting";
import { characterSchema } from "../../src/schema/character";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const ground = defs.hunting.grounds[0]!;
const { rules } = defs.hunting;

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
const hunt = (
  requestId: string,
  huntSeed: string,
  actions: HuntAction[],
  battleWon?: boolean,
) =>
  commitHunting(
    port(),
    CID,
    requestId,
    {
      groundId: ground.id,
      seed: huntSeed,
      actions,
      ...(battleWon !== undefined ? { battleWon } : {}),
    },
    defs.hunting,
    ctx(),
  );
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

/** 가짜 캐릭터의 달 514-3 = 여름. 그 짐승을 쫓는 씨앗 */
const seedFor = (prey: string) => {
  for (let s = 0; ; s++)
    if (planHunt(`e${s}`, ground, "여름", rules).prey.id === prey)
      return `e${s}`;
};
const follow = (huntSeed: string): HuntAction[] =>
  planHunt(huntSeed, ground, "여름", rules).forks.map((f) => ({
    kind: "길",
    path: f.paths.findIndex((p) => p.right),
    pace: "조용히",
  }));
const graze =
  barZones(barWidths(rules.distance.start, rules), BAR_LENGTH).normal[0] + 0.1;

describe("사냥 저장", () => {
  it("흔적을 따라가 완벽하게 쏘면 짐승의 물건을 가방에, 피로 +1. 같은 요청은 한 번", async () => {
    const s = seedFor("grass-hare");
    const actions: HuntAction[] = [
      ...follow(s),
      { kind: "쏘기", position: BAR_LENGTH / 2 },
    ];
    const result = await hunt("h1", s, actions);
    expect(result.status).toBe("ok");
    const c = await character();
    expect(
      Object.values(c.bag.stacks)
        .map((st) => st.itemId)
        .sort(),
    ).toEqual(["rabbit-fur", "rabbit-meat"]);
    expect(c.month.fatigue[HUNTING_FATIGUE]).toBe(1);
    expect(await readAll(testEnv, `requests/${CID}/h1`)).toMatchObject({
      kind: "사냥",
    });
    expect(await hunt("h1", s, actions)).toEqual({ status: "duplicate" });
  });

  it("빗나가도 피로는 오른다, 가방은 그대로", async () => {
    const s = seedFor("antelope");
    expect(
      (await hunt("h1", s, [...follow(s), { kind: "쏘기", position: null }]))
        .status,
    ).toBe("ok");
    const c = await character();
    expect(c.month.fatigue[HUNTING_FATIGUE]).toBe(1);
    expect(c.bag.stacks).toEqual({});
  });

  it("멧돼지가 달려들면 전투에서 이겼을 때만 얻는다. 전투 결과가 없으면 거절", async () => {
    const s = seedFor("boar");
    const actions: HuntAction[] = [
      ...follow(s),
      { kind: "쏘기", position: graze },
    ];
    expect(await hunt("h0", s, actions)).toEqual({
      status: "rejected",
      detail: "달려든 짐승과의 전투 결과가 없다",
    });
    expect((await hunt("h1", s, actions, false)).status).toBe("ok");
    expect((await character()).bag.stacks).toEqual({});
    expect((await hunt("h2", s, actions, true)).status).toBe("ok");
    const stacks = Object.values((await character()).bag.stacks);
    expect(stacks.map((st) => st.itemId).sort()).toEqual([
      "boar-hide",
      "boar-tusk",
    ]);
    expect(stacks.every((st) => st.quality === rules.quality.전투)).toBe(true);
  });

  it("끝나지 않은 사냥이나 할 수 없는 행동은 아무것도 저장하지 않는다", async () => {
    const s = seedFor("grass-hare");
    expect(await hunt("h1", s, follow(s))).toEqual({
      status: "rejected",
      detail: "사냥이 아직 끝나지 않았다",
    });
    expect(await hunt("h2", s, [{ kind: "다가가기" }])).toEqual({
      status: "rejected",
      detail: "아직 짐승이 보이지 않는다",
    });
    const c = await character();
    expect(c.meta.rev).toBe(0);
    expect(c.month.fatigue[HUNTING_FATIGUE]).toBeUndefined();
  });
});
