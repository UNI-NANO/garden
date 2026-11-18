import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbPort } from "../../src/data/commit";
import {
  enterDungeon,
  finishExpedition,
  readExpedition,
  saveExpedition,
} from "../../src/data/dungeon";
import { commitFishing } from "../../src/data/fishing";
import { paths } from "../../src/data/paths";
import { commitRaid } from "../../src/data/raid";
import { commitWallTest } from "../../src/data/training";
import { codexRewardId } from "../../src/rules/codex";
import { raidWeek } from "../../src/rules/raid";
import { characterSchema } from "../../src/schema/character";
import { idToKey } from "../../src/schema/keys";
import { limits, makeCharacter } from "../helpers/fake-character";
import { realDefs } from "../helpers/real-defs";
import { CID, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

const defs = realDefs();
const enemies = new Map(defs.enemies.enemies.map((e) => [e.id, e]));
const ground = defs.training.grounds[0]!;

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

const port = (): DbPort =>
  portOf(testEnv.authenticatedContext(OWNER).database());
const ctx = () => ({
  limits,
  items: defs.itemMap,
  now: Date.now(),
  carryLimit: 1000,
});
const character = async () =>
  characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));
const seedWith = async (
  edit: (c: ReturnType<typeof makeCharacter>) => void = () => undefined,
) => {
  const c = makeCharacter(OWNER);
  c.talents.chosen = ["agility", "sturdy", "intuition"];
  c.mastery[idToKey("sword")] = {
    value: 59.99,
    passed60: false,
    passed80: false,
  };
  edit(c);
  await seed(testEnv, c);
};
const wallTest = (rid: string, won: boolean) =>
  commitWallTest(
    port(),
    CID,
    rid,
    { groundId: ground.id, skill: "sword", skillName: "검술", wall: 60, won },
    defs.training,
    ctx(),
  );

describe("적 도감 저장", () => {
  it("교관 대련: 지면 만남만, 이기면 이긴 수 +1", async () => {
    await seedWith();
    await wallTest("t1", false);
    expect((await character()).codex.enemies["old-instructor"]).toBe(0);
    await wallTest("t2", true);
    expect((await character()).codex.enemies["old-instructor"]).toBe(1);
  });

  it("3단계가 열리면 완성 보상 잎전을 한 번 받는다", async () => {
    await seedWith((c) => {
      c.codex.enemies["old-instructor"] = 14;
      c.wallet = 10;
    });
    expect((await wallTest("t3", true)).status).toBe("ok");
    const c = await character();
    const money = enemies.get("old-instructor")!.codex!.completionMoney!;
    expect(c.wallet).toBe(10 + money);
    expect(c.claimedRewards[idToKey(codexRewardId("old-instructor"))]).toBe(
      true,
    );
    expect(await readAll(testEnv, paths.ledger(CID, "t3"))).toMatchObject({
      walletDelta: money,
    });
  });

  it("반복 레이드: 보스 무리를 만나고, 이기면 센다", async () => {
    await seedWith();
    const week = raidWeek(Date.now(), defs.raids, limits);
    const zero = {
      damage: 0,
      stagger: 0,
      prevented: 0,
      reactions: 0,
      score: 0,
    };
    await commitRaid(
      port(),
      CID,
      "r1",
      {
        weekKey: week.key,
        bossId: week.boss.id,
        won: true,
        contribution: zero,
      },
      defs.raids,
      ctx(),
    );
    const c = await character();
    for (const m of week.boss.enemies)
      expect(c.codex.enemies[idToKey(m.enemy)]).toBeGreaterThanOrEqual(1);
  });

  it("던전: 싸운 적은 정산 때 한 번에 반영 (전멸해도 남는다)", async () => {
    await seedWith();
    const forest = defs.dungeons[0]!;
    await enterDungeon(
      port(),
      CID,
      "e1",
      { dungeon: forest, seed: "e1", maxHp: 100, maxEnergy: 6 },
      ctx(),
    );
    const found = (await readExpedition(port(), CID))!;
    expect(
      await saveExpedition(port(), CID, found.id, {
        ...found.state,
        status: "전멸",
        battles: { wolf: 2, "wolf.alpha": 0 },
      }),
    ).toBe("ok");
    expect(
      (
        await finishExpedition(
          port(),
          CID,
          "f1",
          new Map(defs.dungeons.map((d) => [d.id, d])),
          ctx(),
        )
      ).status,
    ).toBe("ok");
    const c = await character();
    expect(c.codex.enemies["wolf"]).toBe(2);
    expect(c.codex.enemies[idToKey("wolf.alpha")]).toBe(0);
  });
});

describe("물건 도감 저장", () => {
  it("처음 얻은 때만 적고, 다시 얻어도 그대로", async () => {
    await seedWith();
    const spot = defs.fishing.spots[0]!;
    const fish = (rid: string) =>
      commitFishing(
        port(),
        CID,
        rid,
        {
          spotId: spot.id,
          seed: "s",
          power: 0.2,
          outcome: { kind: "낚음", accuracy: 1, maxTension: 0.5 },
        },
        defs.fishing,
        ctx(),
      );
    const r = await fish("f1");
    expect(r.status).toBe("ok");
    const item = r.status === "ok" ? r.caught!.item : "";
    const first = (await character()).codex.items[idToKey(item)];
    expect(first).toBeGreaterThan(0);
    await fish("f2");
    expect((await character()).codex.items[idToKey(item)]).toBe(first);
  });
});

describe("도감 보안 규칙", () => {
  it("이긴 수를 줄이거나, 물건 처음 얻은 때를 덮어쓸 수 없다", async () => {
    await seedWith((c) => {
      c.codex.enemies["wolf"] = 3;
      c.codex.items["timber"] = 5;
    });
    const db = port();
    const attempt = async (rid: string, path: string, v: number) => {
      const rev = (await readAll(
        testEnv,
        `characters/${CID}/meta/rev`,
      )) as number;
      return db.update({
        [paths.characterPart(CID, "meta/rev")]: rev + 1,
        [paths.characterPart(CID, "meta/lastRequestId")]: rid,
        [paths.request(CID, rid)]: { at: Date.now(), kind: "사냥" },
        [paths.characterPart(CID, path)]: v,
      });
    };
    expect(await attempt("h1", "codex/enemies/wolf", 1)).toBe("denied");
    expect(await attempt("h2", "codex/items/timber", 9)).toBe("denied");
    expect(await attempt("h3", "codex/enemies/wolf", 4)).toBe("ok");
    expect(await attempt("h4", "codex/items/hill-mugwort", Date.now())).toBe(
      "ok",
    );
  });
});
