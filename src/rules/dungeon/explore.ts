import { battleTally, mergeTally } from "../codex";
import type { Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import type { Floor, Pickup } from "./floor";

/**
 * 던전 탐험의 진행 (명세서 「던전」 → 움직이기·쉼터·끝). 혼자 탐험만.
 * 모두 순수 함수다: 상태와 층 지도를 받아 새 상태를 돌려주고, 할 수 없는 일이면 DungeonError를 던진다.
 * 층 지도는 저장하지 않는다(씨앗에서 다시 만든다). 저장하는 것은 방마다 밝혀짐·들어감·클리어·주운 것.
 */

export class DungeonError extends Error {
  override name = "DungeonError";
}

/** 얻은 것 한 줄. 아직 가방에 들어간 것이 아니다 */
export type Gain = { kind: "묶음"; item: string; quantity: number } | { kind: "낱개"; item: string } | { kind: "잎전"; quantity: number };

export interface RoomState {
  /** 윤곽이 밝혀짐 */
  seen?: true;
  /** 들어가 봄 */
  entered?: true;
  /** 싸움을 이김 / 함정을 지남 / 잠긴 문·벽을 엶 */
  cleared?: true;
  /** 주운 것: 그 방의 loot 번호 */
  taken?: number[];
}

export type ExpeditionStatus = "탐험" | "귀환" | "전멸" | "보스";

export interface Expedition {
  dungeonId: string;
  seed: string;
  startedAt: number;
  /** 그날 탐험 분야 몇 번째인가 (1부터): 보상 곡선 */
  fatigueIndex: number;
  floor: number;
  at: number;
  /** 방 번호 → 상태 (지금 층만) */
  rooms: Record<string, RoomState>;
  keys: number;
  bombs: number;
  /** 방을 옮길 때마다 +1, 층을 내려가면 0 */
  pressure: number;
  /** 이 층의 쉼터를 썼다 */
  restUsed: boolean;
  /** 정예를 이겨 계단이 열렸다 */
  stairs: boolean;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  /** 싸우는 중인 방 (문이 닫힘) */
  fight?: number;
  gains: Gain[];
  /** 이번 탐험에서 싸운 적: 적 ID → 이긴 수 (적 도감, 정산 때 반영) */
  battles?: Record<string, number>;
  status: ExpeditionStatus;
}

export interface ExploreContext {
  limits: Limits;
  items: ReadonlyMap<string, Item>;
  /** 재능 「눈치」가 있어 금 간 벽이 보인다 */
  seesCracks: boolean;
}

const roomOf = (floor: Floor, index: number) => {
  const room = floor.rooms[index];
  if (!room) throw new DungeonError(`없는 방 ${index}`);
  return room;
};

const isFightRoom = (kind: string) => kind === "전투" || kind === "정예" || kind === "보스";

function assertExploring(state: Expedition) {
  if (state.status !== "탐험") throw new DungeonError("탐험이 끝났다");
}
function assertFree(state: Expedition) {
  assertExploring(state);
  if (state.fight !== undefined) throw new DungeonError("싸우는 중에는 할 수 없다");
}

/** 들어간 방과 문으로 이어진 옆방의 윤곽을 밝힌다 */
function reveal(state: Expedition, floor: Floor, index: number): void {
  const room = roomOf(floor, index);
  state.rooms[index] = { ...state.rooms[index], seen: true, entered: true };
  const doors = [...room.doors];
  // 열린 비밀방도 문처럼
  if (room.secret !== undefined && state.rooms[room.secret]?.cleared) doors.push(room.secret);
  for (const to of doors) state.rooms[to] = { ...state.rooms[to], seen: true };
}

/** 층에 막 들어섰을 때: 시작방과 옆방이 보인다 */
function enterFloor(state: Expedition, floor: Floor): void {
  state.floor = floor.number;
  state.at = floor.start;
  state.rooms = {};
  state.pressure = 0;
  state.restUsed = false;
  state.stairs = false;
  delete state.fight;
  reveal(state, floor, floor.start);
}

/** 탐험 시작. 체력·기력은 가득 찬 채로 */
export function startExpedition(input: {
  dungeonId: string;
  seed: string;
  now: number;
  fatigueIndex: number;
  maxHp: number;
  maxEnergy: number;
  firstFloor: Floor;
}): Expedition {
  const state: Expedition = {
    dungeonId: input.dungeonId,
    seed: input.seed,
    startedAt: input.now,
    fatigueIndex: input.fatigueIndex,
    floor: 1,
    at: 0,
    rooms: {},
    keys: 0,
    bombs: 0,
    pressure: 0,
    restUsed: false,
    stairs: false,
    hp: input.maxHp,
    maxHp: input.maxHp,
    energy: input.maxEnergy,
    maxEnergy: input.maxEnergy,
    gains: [],
    status: "탐험",
  };
  enterFloor(state, input.firstFloor);
  return state;
}

/** 지금 방에서 갈 수 있는 방 (열린 비밀방 포함) */
export function exits(state: Expedition, floor: Floor): number[] {
  const room = roomOf(floor, state.at);
  const doors = [...room.doors];
  if (room.secret !== undefined && state.rooms[room.secret]?.cleared) doors.push(room.secret);
  // 비밀방에서는 들어온 벽으로 되돌아간다
  for (const r of floor.rooms) if (r.secret === state.at) doors.push(r.index);
  return doors;
}

/** 옆방으로 옮긴다. 잠긴 보물방은 열쇠 하나를 쓰고 열린다. 싸우는 방은 문이 닫히고, 함정은 체력을 낸다 */
export function move(before: Expedition, floor: Floor, to: number, ctx: ExploreContext): Expedition {
  assertFree(before);
  if (!exits(before, floor).includes(to)) throw new DungeonError("이어진 방이 아니다");
  const state = structuredClone(before);
  const room = roomOf(floor, to);
  const roomState = state.rooms[to] ?? {};
  if (room.kind === "보물" && !roomState.cleared) {
    if (state.keys < 1) throw new DungeonError("잠긴 방: 열쇠가 필요하다");
    state.keys -= 1;
    state.rooms[to] = { ...roomState, cleared: true };
  }
  state.at = to;
  state.pressure += 1;
  reveal(state, floor, to);
  const now = state.rooms[to]!;
  if (isFightRoom(room.kind) && !now.cleared) state.fight = to;
  if (room.kind === "함정" && !now.cleared) {
    const cost = Math.ceil(state.maxHp * ctx.limits.dungeon.trapHpShare);
    state.hp = Math.max(1, state.hp - cost);
    state.rooms[to] = { ...now, cleared: true };
  }
  return state;
}

/** 금 간 벽을 폭약으로 연다. 눈치가 있어 벽이 보여야 한다 */
export function blastWall(before: Expedition, floor: Floor, ctx: ExploreContext): Expedition {
  assertFree(before);
  const room = roomOf(floor, before.at);
  if (room.secret === undefined || !ctx.seesCracks) throw new DungeonError("부술 벽이 보이지 않는다");
  if (before.rooms[room.secret]?.cleared) throw new DungeonError("이미 열린 벽");
  if (before.bombs < 1) throw new DungeonError("폭약이 없다");
  const state = structuredClone(before);
  state.bombs -= 1;
  state.rooms[room.secret] = { ...state.rooms[room.secret], seen: true, cleared: true };
  return state;
}

/** 지금 방의 싸움 결과. 이기면 클리어(전투가 끝난 체력 그대로, 기력은 끝난 값에 일부를 더함). 지면 전멸. 던전에서는 도망칠 수 없다 */
export function finishFight(before: Expedition, floor: Floor, result: { outcome: "승리" | "패배"; hp: number; energy: number }, ctx: ExploreContext): Expedition {
  assertExploring(before);
  if (before.fight === undefined) throw new DungeonError("싸우는 중이 아니다");
  const state = structuredClone(before);
  const room = roomOf(floor, state.fight!);
  delete state.fight;
  if (room.group) state.battles = mergeTally(state.battles ?? {}, battleTally(room.group.enemies.map((m) => m.enemy), result.outcome === "승리"));
  if (result.outcome === "패배") {
    state.hp = 0;
    state.status = "전멸";
    return state;
  }
  state.hp = Math.max(1, Math.min(state.maxHp, Math.round(result.hp)));
  state.energy = Math.min(state.maxEnergy, Math.max(0, Math.round(result.energy)) + Math.ceil(state.maxEnergy * ctx.limits.dungeon.fightEnergyShare));
  state.rooms[room.index] = { ...state.rooms[room.index], cleared: true };
  if (room.kind === "정예") state.stairs = true;
  if (room.kind === "보스") state.status = "보스";
  return state;
}

/** 지금 방에서 주울 수 있는 것: 번호와 함께. 싸우는 방은 이긴 뒤에 */
export function pickups(state: Expedition, floor: Floor): { index: number; pickup: Pickup }[] {
  const room = roomOf(floor, state.at);
  const roomState = state.rooms[state.at] ?? {};
  if (isFightRoom(room.kind) && !roomState.cleared) return [];
  return room.loot.map((pickup, index) => ({ index, pickup })).filter(({ index }) => !roomState.taken?.includes(index));
}

/** 얻은 것이 차지하는 칸 (같은 물건 묶음은 한 칸, 잎전은 칸 없음) */
export const usedSlots = (gains: readonly Gain[]) => gains.filter((g) => g.kind !== "잎전").length;

/** 하나 줍는다. 칸이 모자라면 못 줍는다 */
export function take(before: Expedition, floor: Floor, index: number, ctx: ExploreContext): Expedition {
  assertFree(before);
  const found = pickups(before, floor).find((p) => p.index === index);
  if (!found) throw new DungeonError("주울 것이 없다");
  const state = structuredClone(before);
  const { pickup } = found;
  if (pickup.kind === "열쇠") state.keys += 1;
  else if (pickup.kind === "폭약") state.bombs += 1;
  else if (pickup.kind === "잎전") {
    const same = state.gains.find((g) => g.kind === "잎전");
    if (same && same.kind === "잎전") same.quantity += pickup.quantity;
    else state.gains.push({ kind: "잎전", quantity: pickup.quantity });
  } else {
    const item = ctx.items.get(pickup.item);
    if (!item) throw new DungeonError(`정의에 없는 물건: ${pickup.item}`);
    const same = item.kind === "묶음" ? state.gains.find((g) => g.kind === "묶음" && g.item === pickup.item) : undefined;
    if (same && same.kind === "묶음") same.quantity += pickup.quantity;
    else {
      if (usedSlots(state.gains) >= ctx.limits.dungeon.lootSlots) throw new DungeonError("얻은 것의 칸이 가득 찼다");
      state.gains.push(item.kind === "묶음" ? { kind: "묶음", item: pickup.item, quantity: pickup.quantity } : { kind: "낱개", item: pickup.item });
    }
  }
  const roomState = state.rooms[state.at] ?? {};
  state.rooms[state.at] = { ...roomState, taken: [...(roomState.taken ?? []), index] };
  return state;
}

/** 쉼터 (층마다 한 번): 쉬기(체력·기력 일부 회복) 또는 귀환(전부 가지고 끝) */
export function useRest(before: Expedition, floor: Floor, choice: "쉬기" | "귀환", ctx: ExploreContext): Expedition {
  assertFree(before);
  if (before.at !== floor.rest) throw new DungeonError("쉼터가 아니다");
  if (before.restUsed) throw new DungeonError("이 층의 쉼터는 이미 썼다");
  const state = structuredClone(before);
  state.restUsed = true;
  if (choice === "귀환") {
    state.status = "귀환";
    return state;
  }
  const share = ctx.limits.dungeon.restShare;
  state.hp = Math.min(state.maxHp, state.hp + Math.ceil(state.maxHp * share));
  state.energy = Math.min(state.maxEnergy, state.energy + Math.ceil(state.maxEnergy * share));
  return state;
}

/** 정예를 이긴 끝방에서 다음 층으로. 새 층을 받는다 */
export function descend(before: Expedition, floor: Floor, next: Floor): Expedition {
  assertFree(before);
  if (floor.last) throw new DungeonError("마지막 층");
  if (before.at !== floor.end || !before.stairs) throw new DungeonError("계단이 열리지 않았다");
  if (next.number !== floor.number + 1) throw new DungeonError("다음 층이 아니다");
  const state = structuredClone(before);
  enterFloor(state, next);
  return state;
}
