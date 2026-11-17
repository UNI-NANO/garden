import type { Dungeon, EnemyGroup, LootTable } from "../../schema/defs/dungeon";
import type { Item } from "../../schema/defs/item";
import { createRng, type Rng } from "../rng";

/**
 * 던전 층 만들기 (명세서 「던전」 → 층 만들기). 같은 씨앗·층이면 언제 다시 만들어도 같은 지도가 나온다.
 *
 * 방들은 시작방에서 뻗어 나가는 나무 모양으로 붙는다(문 = 부모와 자식 사이). 그래서 길은 하나뿐이고,
 * 보물방(잠김)은 막다른 방, 비밀방은 일반 방의 벽 너머에만 둔다 → 열쇠·폭약 없이도 끝방과 쉼터에 반드시 닿는다.
 */

export type RoomKind = "시작" | "쉼터" | "전투" | "함정" | "보물" | "비밀" | "정예" | "보스";

export type Pickup = { kind: "물건"; item: string; quantity: number } | { kind: "잎전"; quantity: number } | { kind: "열쇠" } | { kind: "폭약" };

export interface Room {
  index: number;
  x: number;
  y: number;
  kind: RoomKind;
  /** 문으로 이어진 방 (비밀방으로 가는 벽은 빠진다) */
  doors: number[];
  /** 이 방의 금 간 벽 너머 비밀방 */
  secret?: number;
  /** 전투·정예·보스방의 적 무리 */
  group?: EnemyGroup;
  /** 놓인 것. 싸우는 방은 이긴 뒤에 주울 수 있다 */
  loot: Pickup[];
}

export interface Floor {
  number: number;
  last: boolean;
  rooms: Room[];
  start: number;
  rest: number;
  end: number;
}

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const at = (x: number, y: number) => `${x},${y}`;

function pickWeighted<T extends { weight: number }>(rng: Rng, list: readonly T[]): T {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.next() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return list[list.length - 1]!;
}

const pickOne = <T>(rng: Rng, list: readonly T[]): T => list[rng.int(0, list.length - 1)]!;

/** 전리품 수량에 피로 곡선을 적용한다: 내림, 최소 1 */
export const scaleQuantity = (quantity: number, multiplier: number) => Math.max(1, Math.floor(quantity * multiplier));

/** 전리품표를 굴린다. 같은 물건은 한데 모은다. 낱개 물건은 수량 1에 배율을 쓰지 않는다 */
export function rollLoot(rng: Rng, table: LootTable, items: ReadonlyMap<string, Item>, multiplier: number): Pickup[] {
  const out: Pickup[] = [];
  const rolls = rng.int(table.rolls.min, table.rolls.max);
  for (let i = 0; i < rolls; i++) {
    const entry = pickWeighted(rng, table.entries);
    const raw = rng.int(entry.quantity.min, entry.quantity.max);
    if (entry.kind === "잎전") {
      const quantity = scaleQuantity(raw, multiplier);
      const same = out.find((p) => p.kind === "잎전");
      if (same && same.kind === "잎전") same.quantity += quantity;
      else out.push({ kind: "잎전", quantity });
      continue;
    }
    const single = items.get(entry.item)?.kind === "낱개";
    if (single) {
      out.push({ kind: "물건", item: entry.item, quantity: 1 });
      continue;
    }
    const quantity = scaleQuantity(raw, multiplier);
    const same = out.find((p) => p.kind === "물건" && p.item === entry.item);
    if (same && same.kind === "물건") same.quantity += quantity;
    else out.push({ kind: "물건", item: entry.item, quantity });
  }
  return out;
}

/**
 * 층 하나를 만든다.
 * @param number 1부터
 * @param lootMultiplier 피로 곡선 배율 (첫 클리어 보상에는 쓰지 않는다)
 */
export function generateFloor(dungeon: Dungeon, number: number, seed: string, items: ReadonlyMap<string, Item>, lootMultiplier: number): Floor {
  const spec = dungeon.floors[number - 1];
  if (!spec) throw new RangeError(`${dungeon.id}: 없는 층 ${number}`);
  const last = number === dungeon.floors.length;
  const rng = createRng(`${seed}:floor:${number}`);

  const total = rng.int(spec.rooms.min, spec.rooms.max);
  let wantSecret = rng.next() < dungeon.secretChance;
  let wantTreasure = rng.next() < dungeon.treasureChance;
  // 시작·쉼터·끝 셋은 꼭. 남는 자리가 없으면 보물·비밀부터 뺀다
  if (total - (wantSecret ? 1 : 0) < 3 + (wantTreasure ? 1 : 0)) wantTreasure = false;
  if (total - (wantSecret ? 1 : 0) < 3) wantSecret = false;
  const main = total - (wantSecret ? 1 : 0);

  // 나무 모양으로 방을 붙인다
  const rooms: Room[] = [{ index: 0, x: 0, y: 0, kind: "전투", doors: [], loot: [] }];
  const cells = new Map<string, number>([[at(0, 0), 0]]);
  const free = (room: Room) => DIRS.map(([dx, dy]) => [room.x + dx, room.y + dy] as const).filter(([x, y]) => !cells.has(at(x, y)));
  while (rooms.length < main) {
    const parent = pickOne(rng, rooms.filter((r) => free(r).length > 0));
    const [x, y] = pickOne(rng, free(parent));
    const room: Room = { index: rooms.length, x, y, kind: "전투", doors: [parent.index], loot: [] };
    parent.doors.push(room.index);
    rooms.push(room);
    cells.set(at(x, y), room.index);
  }

  // 끝방: 시작에서 가장 먼 막다른 방
  const depth = new Map<number, number>([[0, 0]]);
  const queue = [0];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const to of rooms[from]!.doors) {
      if (depth.has(to)) continue;
      depth.set(to, depth.get(from)! + 1);
      queue.push(to);
    }
  }
  const leaves = rooms.filter((r) => r.index !== 0 && r.doors.length === 1);
  const end = [...leaves].sort((a, b) => depth.get(b.index)! - depth.get(a.index)! || a.index - b.index)[0]!.index;

  const used = new Set([0, end]);
  let treasure: number | undefined;
  if (wantTreasure) {
    const options = leaves.filter((r) => !used.has(r.index));
    if (options.length > 0) {
      treasure = pickOne(rng, options).index;
      used.add(treasure);
    }
  }
  const rest = pickOne(
    rng,
    rooms.filter((r) => !used.has(r.index)),
  ).index;
  used.add(rest);

  rooms[0]!.kind = "시작";
  rooms[end]!.kind = last ? "보스" : "정예";
  rooms[rest]!.kind = "쉼터";
  if (treasure !== undefined) rooms[treasure]!.kind = "보물";
  for (const room of rooms) {
    if (used.has(room.index)) continue;
    room.kind = rng.next() < dungeon.trapShare ? "함정" : "전투";
  }

  // 비밀방: 일반 방(전투·함정)의 빈 벽 너머
  if (wantSecret) {
    const anchors = rooms.filter((r) => (r.kind === "전투" || r.kind === "함정") && free(r).length > 0);
    if (anchors.length > 0) {
      const anchor = pickOne(rng, anchors);
      const [x, y] = pickOne(rng, free(anchor));
      const secret: Room = { index: rooms.length, x, y, kind: "비밀", doors: [], loot: [] };
      anchor.secret = secret.index;
      rooms.push(secret);
      cells.set(at(x, y), secret.index);
    }
  }

  // 적과 전리품
  // 이 층에 나올 수 있는 무리 (정의 검사가 첫 층의 일반 무리를 보장한다. 정예·보스는 없으면 전부에서)
  const pickGroup = (list: readonly EnemyGroup[]) => {
    const here = list.filter((g) => (g.minFloor ?? 1) <= number);
    return pickWeighted(rng, here.length > 0 ? here : list);
  };
  for (const room of rooms) {
    if (room.kind === "전투") room.group = pickGroup(dungeon.groups.일반);
    if (room.kind === "정예") room.group = pickGroup(dungeon.groups.정예);
    if (room.kind === "보스") room.group = pickGroup(dungeon.groups.보스);
    const table = room.kind === "전투" || room.kind === "정예" || room.kind === "보물" || room.kind === "비밀" || room.kind === "보스" ? dungeon.loot[room.kind] : undefined;
    if (table) room.loot = rollLoot(rng, table, items, lootMultiplier);
  }

  // 열쇠와 폭약: 잠기지 않고 숨지 않은, 끝방이 아닌 방에
  const open = rooms.filter((r) => r.kind !== "보물" && r.kind !== "비밀" && r.index !== end);
  if (treasure !== undefined) pickOne(rng, open).loot.push({ kind: "열쇠" });
  if (rng.next() < dungeon.bombChance) pickOne(rng, open).loot.push({ kind: "폭약" });

  return { number, last, rooms, start: 0, rest, end };
}
