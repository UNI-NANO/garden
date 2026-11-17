import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 던전 카드 (명세서 「던전」). 층 지도는 탐험의 씨앗에서 만들어지고, 이 카드는 그 재료다.
 * 숫자는 모두 임시.
 */

const count = z.number().int().min(0);
const share = z.number().min(0).max(1);
const range = z.strictObject({ min: count, max: count }).refine((r) => r.min <= r.max, "min ≤ max 여야 한다");

/** 줍는 것 하나: 물건 또는 잎전, 수량 범위 */
export const LootEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("물건"), item: DefIdSchema, quantity: range, weight: z.number().positive() }),
  z.strictObject({ kind: z.literal("잎전"), quantity: range, weight: z.number().positive() }),
]);
export type LootEntry = z.infer<typeof LootEntrySchema>;

/** 방 하나에서 나오는 것: rolls번 무게대로 고른다 */
export const LootTableSchema = z.strictObject({ rolls: range, entries: z.array(LootEntrySchema).min(1) });
export type LootTable = z.infer<typeof LootTableSchema>;

/** 한 방의 적 무리 */
export const EnemyGroupSchema = z.strictObject({
  weight: z.number().positive(),
  /** 이 층부터 나온다 (1부터) */
  minFloor: z.number().int().min(1).optional(),
  enemies: z
    .array(z.strictObject({ enemy: DefIdSchema, slot: z.number().int().min(0).max(5) }))
    .min(1)
    .max(6),
});
export type EnemyGroup = z.infer<typeof EnemyGroupSchema>;

export const PressureSchema = z.enum(["없음", "물", "무너짐", "안개", "열기"]);
export type Pressure = z.infer<typeof PressureSchema>;

export const FixedRewardSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("물건"), item: DefIdSchema, quantity: count.min(1) }),
  z.strictObject({ kind: z.literal("잎전"), quantity: count.min(1) }),
]);
export type FixedReward = z.infer<typeof FixedRewardSchema>;

export const DungeonSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 입구가 있는 곳 */
  region: z.string().min(1),
  place: z.string().min(1),
  description: z.string(),
  /** 층마다 방 수 (명세서: 8~15). 마지막 층 끝방이 보스방 */
  floors: z.array(z.strictObject({ rooms: range })).min(1).max(10),
  /** 채우는 방(전투·함정) 가운데 함정의 비율 */
  trapShare: share,
  /** 층마다 보물방·비밀방이 생길 확률, 폭약 하나가 놓일 확률 */
  treasureChance: share,
  secretChance: share,
  bombChance: share,
  pressure: PressureSchema,
  groups: z.strictObject({ 일반: z.array(EnemyGroupSchema).min(1), 정예: z.array(EnemyGroupSchema).min(1), 보스: z.array(EnemyGroupSchema).min(1) }),
  loot: z.strictObject({ 전투: LootTableSchema, 정예: LootTableSchema, 보물: LootTableSchema, 비밀: LootTableSchema, 보스: LootTableSchema }),
  /** 처음 보스를 이겼을 때 한 번 (피로 곡선 없음) */
  firstClear: z.array(FixedRewardSchema),
});
export type Dungeon = z.infer<typeof DungeonSchema>;

export const DungeonListSchema = z.strictObject({
  ...defHeader,
  dungeons: z.array(DungeonSchema),
});
export type DungeonList = z.infer<typeof DungeonListSchema>;
