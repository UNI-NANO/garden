import { describe, expect, it } from "vitest";
import { generateFloor, type Floor } from "../src/rules/dungeon/floor";
import {
  blastWall,
  descend,
  DungeonError,
  exits,
  finishFight,
  move,
  pickups,
  startExpedition,
  take,
  useRest,
  type Expedition,
  type ExploreContext,
} from "../src/rules/dungeon/explore";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const forest = defs.dungeons.find((d) => d.id === "border-forest")!;
const ctx = (seesCracks = true): ExploreContext => ({ limits: defs.limits, items: defs.itemMap, seesCracks });
const floorOf = (seed: string, n: number) => generateFloor(forest, n, seed, defs.itemMap, 1);

/** 첫 층에 보물방·비밀방·폭약이 다 있는 씨앗 */
const seed = (() => {
  for (let s = 0; ; s++) {
    const f = floorOf(`x${s}`, 1);
    const has = (kind: string) => f.rooms.some((r) => r.kind === kind);
    const bomb = f.rooms.some((r) => r.loot.some((p) => p.kind === "폭약") && r.kind !== "보물" && r.kind !== "비밀");
    if (has("보물") && has("비밀") && bomb) return `x${s}`;
  }
})();

const begin = (floor: Floor) => startExpedition({ dungeonId: forest.id, seed, now: 0, fatigueIndex: 1, maxHp: 100, maxEnergy: 6, firstFloor: floor });

/** 이긴 싸움으로 처리하며 target까지 걷는다 (잠긴 방은 피해서) */
function walkTo(state: Expedition, floor: Floor, target: number): Expedition {
  const prev = new Map<number, number>([[state.at, -1]]);
  const queue = [state.at];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const to of floor.rooms[from]!.doors) {
      if (prev.has(to) || (floor.rooms[to]!.kind === "보물" && to !== target)) continue;
      prev.set(to, from);
      queue.push(to);
    }
  }
  const path: number[] = [];
  for (let at = target; at !== state.at; at = prev.get(at)!) path.unshift(at);
  for (const step of path) {
    state = move(state, floor, step, ctx());
    if (state.fight !== undefined) state = finishFight(state, floor, { outcome: "승리", hp: state.hp, energy: state.energy }, ctx());
  }
  return state;
}

describe("던전 탐험", () => {
  const floor = floorOf(seed, 1);

  it("시작: 시작방과 옆방만 보이고, 체력·기력은 가득", () => {
    const state = begin(floor);
    expect(state.at).toBe(floor.start);
    expect(state.rooms[floor.start]).toEqual({ seen: true, entered: true });
    const seen = Object.keys(state.rooms).map(Number).sort((a, b) => a - b);
    expect(seen).toEqual([floor.start, ...floor.rooms[floor.start]!.doors].sort((a, b) => a - b));
    expect([state.hp, state.energy, state.pressure]).toEqual([100, 6, 0]);
  });

  it("이어진 방으로만 옮기고, 옮길 때마다 압박 +1. 싸우는 방은 문이 닫힌다", () => {
    let state = begin(floor);
    const far = floor.rooms.find((r) => !exits(state, floor).includes(r.index) && r.index !== floor.start)!;
    expect(() => move(state, floor, far.index, ctx())).toThrow(DungeonError);
    const fightRoom = floor.rooms.find((r) => r.kind === "전투")!;
    state = walkTo(state, floor, floor.rooms[fightRoom.index]!.doors[0]!);
    const before = state.pressure;
    state = move(state, floor, fightRoom.index, ctx());
    if (state.rooms[fightRoom.index]?.cleared) return; // 이미 지나온 방
    expect(state.pressure).toBe(before + 1);
    expect(state.fight).toBe(fightRoom.index);
    expect(pickups(state, floor)).toEqual([]);
    expect(() => move(state, floor, fightRoom.doors[0]!, ctx())).toThrow("싸우는 중");
    state = finishFight(state, floor, { outcome: "승리", hp: 40, energy: 1 }, ctx());
    expect(state.fight).toBeUndefined();
    expect(state.hp).toBe(40);
    expect(state.energy).toBe(1 + Math.ceil(6 * defs.limits.dungeon.fightEnergyShare));
    expect(pickups(state, floor)).toHaveLength(fightRoom.loot.length);
  });

  it("함정은 처음 지날 때만 체력을 낸다 (1은 남음)", () => {
    const trapSeed = (() => {
      for (let s = 0; ; s++) if (floorOf(`t${s}`, 1).rooms.some((r) => r.kind === "함정")) return `t${s}`;
    })();
    const f = floorOf(trapSeed, 1);
    const trap = f.rooms.find((r) => r.kind === "함정")!;
    let state = startExpedition({ dungeonId: forest.id, seed: trapSeed, now: 0, fatigueIndex: 1, maxHp: 100, maxEnergy: 6, firstFloor: f });
    state = walkTo(state, f, trap.doors[0]!);
    if (state.rooms[trap.index]?.cleared) return;
    state = { ...state, hp: 50 };
    state = move(state, f, trap.index, ctx());
    expect(state.hp).toBe(50 - Math.ceil(100 * defs.limits.dungeon.trapHpShare));
    state = move(state, f, trap.doors[0]!, ctx());
    const hp = state.hp;
    state = move(state, f, trap.index, ctx());
    expect(state.hp).toBe(hp);
    state = move({ ...state, at: trap.doors[0]!, hp: 2, rooms: { ...state.rooms, [trap.index]: { seen: true } } }, f, trap.index, ctx());
    expect(state.hp).toBe(1);
  });

  it("보물방은 열쇠 하나로 열리고, 비밀방은 눈치가 있을 때 폭약으로", () => {
    const treasure = floor.rooms.find((r) => r.kind === "보물")!;
    const keyRoom = floor.rooms.find((r) => r.loot.some((p) => p.kind === "열쇠"))!;
    let state = walkTo(begin(floor), floor, treasure.doors[0]!);
    expect(() => move(state, floor, treasure.index, ctx())).toThrow("열쇠");
    state = walkTo(state, floor, keyRoom.index);
    state = take(state, floor, keyRoom.loot.findIndex((p) => p.kind === "열쇠"), ctx());
    expect(state.keys).toBe(1);
    state = walkTo(state, floor, treasure.doors[0]!);
    state = move(state, floor, treasure.index, ctx());
    expect(state.keys).toBe(0);
    state = move(state, floor, treasure.doors[0]!, ctx());
    state = move(state, floor, treasure.index, ctx()); // 다시 들어갈 때는 열쇠 없이

    const bombRoom = floor.rooms.find((r) => r.loot.some((p) => p.kind === "폭약") && r.kind !== "보물" && r.kind !== "비밀")!;
    state = walkTo(state, floor, bombRoom.index);
    state = take(state, floor, bombRoom.loot.findIndex((p) => p.kind === "폭약"), ctx());
    const secret = floor.rooms.find((r) => r.kind === "비밀")!;
    const anchor = floor.rooms.find((r) => r.secret === secret.index)!;
    state = walkTo(state, floor, anchor.index);
    expect(exits(state, floor)).not.toContain(secret.index);
    expect(() => blastWall(state, floor, ctx(false))).toThrow("보이지");
    state = blastWall(state, floor, ctx());
    expect(state.bombs).toBe(0);
    expect(() => blastWall(state, floor, ctx())).toThrow("이미");
    state = move(state, floor, secret.index, ctx());
    expect(exits(state, floor)).toEqual([anchor.index]);
    expect(pickups(state, floor)).toHaveLength(secret.loot.length);
  });

  it("줍기: 같은 묶음은 한 칸, 칸이 차면 새 물건은 못 줍는다", () => {
    const hasStack = (r: Floor["rooms"][number]) => r.kind === "전투" && r.loot.some((p) => p.kind === "물건" && defs.itemMap.get(p.item)?.kind === "묶음");
    const lootSeed = (() => {
      for (let s = 0; ; s++) if (floorOf(`l${s}`, 1).rooms.some(hasStack)) return `l${s}`;
    })();
    const floor = floorOf(lootSeed, 1);
    const fightRoom = floor.rooms.find(hasStack)!;
    let state = walkTo(startExpedition({ dungeonId: forest.id, seed: lootSeed, now: 0, fatigueIndex: 1, maxHp: 100, maxEnergy: 6, firstFloor: floor }), floor, fightRoom.index);
    const index = fightRoom.loot.findIndex((p) => p.kind === "물건" && defs.itemMap.get(p.item)?.kind === "묶음");
    const full: Expedition = { ...state, gains: Array.from({ length: defs.limits.dungeon.lootSlots }, (_, i) => ({ kind: "낱개" as const, item: `x${i}` })) };
    expect(() => take(full, floor, index, ctx())).toThrow("칸");
    state = take(state, floor, index, ctx());
    expect(() => take(state, floor, index, ctx())).toThrow("주울 것");
    const pickup = fightRoom.loot[index]!;
    if (pickup.kind !== "물건") throw new Error();
    const again = take({ ...state, rooms: { ...state.rooms, [fightRoom.index]: { ...state.rooms[fightRoom.index], taken: [] } } }, floor, index, ctx());
    expect(again.gains.filter((g) => g.kind !== "잎전")).toHaveLength(1);
  });

  it("쉼터는 층마다 한 번: 쉬기 또는 귀환", () => {
    let state = walkTo(begin(floor), floor, floor.rest);
    state = { ...state, hp: 10, energy: 0 };
    const rested = useRest(state, floor, "쉬기", ctx());
    expect(rested.hp).toBe(10 + Math.ceil(100 * defs.limits.dungeon.restShare));
    expect(rested.energy).toBe(Math.ceil(6 * defs.limits.dungeon.restShare));
    expect(() => useRest(rested, floor, "귀환", ctx())).toThrow("이미");
    const home = useRest(state, floor, "귀환", ctx());
    expect(home.status).toBe("귀환");
    expect(() => move(home, floor, floor.rooms[floor.rest]!.doors[0]!, ctx())).toThrow("끝났다");
  });

  it("정예를 이기면 계단 → 다음 층(압박·쉼터 새로), 마지막 층 보스를 이기면 끝", () => {
    let state = begin(floor);
    expect(() => descend(state, floor, floorOf(seed, 2))).toThrow("계단");
    state = walkTo(state, floor, floor.end);
    expect(state.stairs).toBe(true);
    for (let n = 2; n <= forest.floors.length; n++) {
      const here = floorOf(seed, n - 1);
      const next = floorOf(seed, n);
      state = descend(state, here, next);
      expect([state.floor, state.at, state.pressure, state.restUsed, state.stairs]).toEqual([n, next.start, 0, false, false]);
      state = walkTo(state, next, next.end);
    }
    expect(state.status).toBe("보스");
  });

  it("싸움에 지면 전멸", () => {
    const fightRoom = floor.rooms.find((r) => r.kind === "전투")!;
    let state = walkTo(begin(floor), floor, fightRoom.doors[0]!);
    if (state.rooms[fightRoom.index]?.cleared) return;
    state = move(state, floor, fightRoom.index, ctx());
    state = finishFight(state, floor, { outcome: "패배", hp: 0, energy: 0 }, ctx());
    expect(state.status).toBe("전멸");
  });
});
