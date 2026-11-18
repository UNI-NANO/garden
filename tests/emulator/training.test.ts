import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import { commitWallTest, TRAINING_FATIGUE } from "../../src/data/training";
import { characterSchema } from "../../src/schema/character";
import { idToKey } from "../../src/schema/keys";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const ground = defs.training.grounds[0]!;

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

const seedWith = async (value: number, passed60 = false) => {
  const c = makeCharacter(OWNER);
  c.mastery[idToKey("sword")] = { value, passed60, passed80: false };
  await seed(testEnv, c);
};
const port = (): DbPort =>
  portOf(testEnv.authenticatedContext(OWNER).database());
const attempt = (requestId: string, wall: 60 | 80, won: boolean) =>
  commitWallTest(
    port(),
    CID,
    requestId,
    { groundId: ground.id, skill: "sword", skillName: "검술", wall, won },
    defs.training,
    { limits, items: defs.itemMap, now: Date.now(), carryLimit: 1000 },
  );
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

describe("교관 대련 저장", () => {
  it("이기면 통과 표시·일생 한 줄·피로 +1. 같은 요청은 한 번", async () => {
    await seedWith(59.99);
    const before = await character();
    expect(await attempt("t1", 60, true)).toEqual({
      status: "ok",
      passed: true,
    });
    const c = await character();
    expect(c.mastery[idToKey("sword")]).toEqual({
      value: 59.99,
      passed60: true,
      passed80: false,
    });
    expect(c.month.fatigue[TRAINING_FATIGUE]).toBe(1);
    expect(c.life.at(-1)?.text).toBe(
      "검술 60 벽을 넘었다 — 늙은 교관과의 대련",
    );
    expect(c.life).toHaveLength(before.life.length + 1);
    expect(c.meta.rev).toBe(before.meta.rev + 1);
    expect(await attempt("t1", 60, true)).toEqual({ status: "duplicate" });
    expect((await character()).month.fatigue[TRAINING_FATIGUE]).toBe(1);
  });

  it("지면 피로만 오르고, 다시 도전할 수 있다", async () => {
    await seedWith(59.99);
    expect(await attempt("t2", 60, false)).toEqual({
      status: "ok",
      passed: false,
    });
    let c = await character();
    expect(c.mastery[idToKey("sword")]?.passed60).toBe(false);
    expect(c.month.fatigue[TRAINING_FATIGUE]).toBe(1);
    expect(await attempt("t3", 60, true)).toEqual({
      status: "ok",
      passed: true,
    });
    c = await character();
    expect(c.month.fatigue[TRAINING_FATIGUE]).toBe(2);
    expect(c.mastery[idToKey("sword")]?.passed60).toBe(true);
  });

  it("80 벽도 같은 방식", async () => {
    const c0 = makeCharacter(OWNER);
    c0.mastery[idToKey("sword")] = {
      value: 79.99,
      passed60: true,
      passed80: false,
    };
    await seed(testEnv, c0);
    expect(await attempt("t4", 80, true)).toEqual({
      status: "ok",
      passed: true,
    });
    expect((await character()).mastery[idToKey("sword")]?.passed80).toBe(true);
  });

  it("막히지 않은 벽은 거절하고 아무것도 쓰지 않는다", async () => {
    await seedWith(42);
    const before = await character();
    expect((await attempt("t5", 60, true)).status).toBe("rejected");
    await seedWith(59.99, true);
    expect((await attempt("t6", 60, true)).status).toBe("rejected");
    expect((await attempt("t7", 80, true)).status).toBe("rejected");
    const after = await character();
    expect(after.meta.rev).toBe(before.meta.rev);
    expect(after.month.fatigue[TRAINING_FATIGUE]).toBeUndefined();
  });
});
