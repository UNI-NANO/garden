import { describe, expect, it } from "vitest";
import {
  battleTally,
  codexEnemyChange,
  codexStage,
  dropsOf,
  fastReveal,
  firstItems,
  inCodex,
  mergeTally,
} from "../src/rules/codex";
import { finishFight, startExpedition } from "../src/rules/dungeon/explore";
import { generateFloor } from "../src/rules/dungeon/floor";
import { fromStored, toStored } from "../src/schema/expedition";
import { idToKey } from "../src/schema/keys";
import { limits, makeCharacter } from "./helpers/fake-character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const enemies = new Map(defs.enemies.enemies.map((e) => [e.id, e]));

describe("도감 — 단계", () => {
  it("만나면 처음 봄, 1·5·15번 이기면 1·2·3단계", () => {
    expect(codexStage(undefined, false, limits)).toBeUndefined();
    expect(
      [0, 1, 4, 5, 14, 15, 99].map((w) => codexStage(w, false, limits)),
    ).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("학식·예민한 감각이면 한 단계씩 빨리 (겹치지 않음)", () => {
    expect([0, 1, 5].map((w) => codexStage(w, true, limits))).toEqual([
      1, 2, 3,
    ]);
    const c = makeCharacter();
    c.talents.chosen = ["agility", "sturdy", "intuition"];
    expect(fastReveal(c, limits)).toBe(false);
    c.talents.chosen = ["agility", "learning", "keen-senses"];
    expect(fastReveal(c, limits)).toBe(true);
    c.talents.chosen = ["agility", "sturdy", "intuition"];
    c.talents.acquired = { [idToKey("keen-senses")]: true };
    expect(fastReveal(c, limits)).toBe(true);
  });
});

describe("도감 — 집계", () => {
  it("이기면 적 하나하나를, 지면 만남만 센다", () => {
    expect(battleTally(["wolf", "wolf", "wolf.alpha"], true)).toEqual({
      wolf: 2,
      "wolf.alpha": 1,
    });
    expect(battleTally(["wolf"], false)).toEqual({ wolf: 0 });
    expect(mergeTally({ wolf: 1 }, { wolf: 2, boar: 0 })).toEqual({
      wolf: 3,
      boar: 0,
    });
  });

  it("허수아비는 도감에 없고, 모르는 적은 무시한다", () => {
    expect(inCodex(enemies.get("training-dummy")!)).toBe(false);
    const change = codexEnemyChange(
      {},
      { "training-dummy": 3, ghost: 1, wolf: 0 },
      enemies,
      false,
      limits,
    );
    expect(change.set).toEqual({ wolf: 0 });
  });

  it("3단계가 열리는 순간에만 완성, 이미 완성이면 다시 아님", () => {
    const key = idToKey("wolf.alpha");
    expect(
      codexEnemyChange(
        { [key]: 14 },
        { "wolf.alpha": 1 },
        enemies,
        false,
        limits,
      ).completed.map((e) => e.id),
    ).toEqual(["wolf.alpha"]);
    expect(
      codexEnemyChange(
        { [key]: 15 },
        { "wolf.alpha": 1 },
        enemies,
        false,
        limits,
      ).completed,
    ).toEqual([]);
    expect(
      codexEnemyChange({ [key]: 4 }, { "wolf.alpha": 1 }, enemies, true, limits)
        .completed,
    ).toHaveLength(1);
    // 바뀌지 않으면 쓰지 않는다
    expect(
      codexEnemyChange({ wolf: 3 }, { wolf: 0 }, enemies, false, limits).set,
    ).toEqual({});
  });

  it("물건은 처음 얻은 것만", () => {
    expect(
      firstItems({ "wolf-pelt": 5 }, ["wolf-pelt", "timber", "timber"], 9),
    ).toEqual({ timber: 9 });
  });
});

describe("도감 — 드롭과 던전", () => {
  it("2단계 드롭은 그 적이 나오는 곳의 정의에서 모은다 (졸개에게 보스 보상은 붙이지 않음)", () => {
    const e = (id: string) => enemies.get(id)!;
    expect(dropsOf(e("boar"), defs)).toEqual(
      expect.arrayContaining(["boar-hide", "boar-tusk"]),
    );
    expect(dropsOf(e("wolf.king.raid"), defs)).toContain("wolf-king-mane");
    expect(dropsOf(e("wolf"), defs).length).toBeGreaterThan(0);
    expect(dropsOf(e("wolf"), defs)).not.toContain("wolf-king-mane");
  });

  it("던전 탐험 기록이 싸운 적을 모으고, 저장·읽기를 거쳐도 그대로", () => {
    const dungeon = defs.dungeons[0]!;
    const ctx = { limits, items: defs.itemMap, seesCracks: false };
    const floor = generateFloor(dungeon, 1, "seed-1", defs.itemMap, 1);
    let state = startExpedition({
      dungeonId: dungeon.id,
      seed: "seed-1",
      now: 0,
      fatigueIndex: 1,
      maxHp: 50,
      maxEnergy: 10,
      firstFloor: floor,
    });
    const room = floor.rooms.find((r) => r.group)!;
    state = { ...state, fight: room.index };
    state = finishFight(
      state,
      floor,
      { outcome: "승리", hp: 40, energy: 5 },
      ctx,
    );
    const expected = battleTally(
      room.group!.enemies.map((m) => m.enemy),
      true,
    );
    expect(state.battles).toEqual(expected);
    expect(fromStored(toStored("x1", state)).state.battles).toEqual(expected);
  });
});
