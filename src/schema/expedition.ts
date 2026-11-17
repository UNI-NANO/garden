import { z } from "zod";
import type { Expedition } from "../rules/dungeon/explore";
import { DefIdSchema } from "./defs/common";
import { KeySchema } from "./keys";

/**
 * 진행 중인 던전 탐험의 저장 모양 (명세서 「던전」 → 저장하는 값). 캐릭터의 `expedition` 칸.
 * 층 지도는 씨앗에서 다시 만들기 때문에 저장하지 않는다.
 * Realtime Database는 숫자 키 객체를 배열로 바꾸므로 방 번호는 `r0`, `r1` … 로 둔다. 빈 객체·배열은 사라지므로 기본값을 둔다.
 */

const count = z.number().int().min(0);

const RoomStateSchema = z.strictObject({
  seen: z.literal(true).optional(),
  entered: z.literal(true).optional(),
  cleared: z.literal(true).optional(),
  taken: z.array(count).optional(),
});

const GainSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("묶음"), item: DefIdSchema, quantity: count.min(1) }),
  z.strictObject({ kind: z.literal("낱개"), item: DefIdSchema }),
  z.strictObject({ kind: z.literal("잎전"), quantity: count.min(1) }),
]);

export const ExpeditionSchema = z.strictObject({
  /** 탐험 ID (들어갈 때의 요청 ID) */
  id: KeySchema,
  dungeonId: DefIdSchema,
  seed: z.string().min(1).max(100),
  startedAt: count,
  fatigueIndex: count.min(1),
  floor: count.min(1),
  at: count,
  rooms: z.record(z.string().regex(/^r[0-9]+$/), RoomStateSchema).default({}),
  keys: count,
  bombs: count,
  pressure: count,
  restUsed: z.boolean(),
  stairs: z.boolean(),
  hp: count,
  maxHp: count.min(1),
  energy: count,
  maxEnergy: count,
  fight: count.optional(),
  gains: z.array(GainSchema).default([]),
  status: z.enum(["탐험", "귀환", "전멸", "보스"]),
});
export type StoredExpedition = z.infer<typeof ExpeditionSchema>;

export function toStored(id: string, state: Expedition): StoredExpedition {
  const rooms: StoredExpedition["rooms"] = {};
  for (const [index, room] of Object.entries(state.rooms)) rooms[`r${index}`] = { ...room, ...(room.taken ? { taken: [...room.taken] } : {}) };
  return ExpeditionSchema.parse({ ...structuredClone(state), id, rooms });
}

export function fromStored(stored: StoredExpedition): { id: string; state: Expedition } {
  const { id, rooms, fight, ...rest } = stored;
  const state: Expedition = { ...structuredClone(rest), rooms: {}, ...(fight !== undefined ? { fight } : {}) };
  for (const [key, room] of Object.entries(rooms)) {
    state.rooms[key.slice(1)] = {
      ...(room.seen ? { seen: true as const } : {}),
      ...(room.entered ? { entered: true as const } : {}),
      ...(room.cleared ? { cleared: true as const } : {}),
      ...(room.taken ? { taken: [...room.taken] } : {}),
    };
  }
  return { id, state };
}
