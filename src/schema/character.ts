import { z } from "zod";
import { DefIdSchema } from "./defs/common";
import type { Limits } from "./defs/limits";
import { KeySchema } from "./keys";

/**
 * 캐릭터 저장 모양 (버전 1, 핵심 칸만).
 * 거처·지도·도감·유물·인물과 동료·이동·스토리·일생 기록은 그 시스템을 만들 때 칸을 더하고 버전을 올린다.
 *
 * Realtime Database에 맞춘 약속:
 * - 빈 객체와 빈 배열은 저장되지 않고 사라진다. 그래서 비어 있을 수 있는 칸은 모두 기본값이 있다.
 * - 목록은 배열 대신 `키 → true` 꼴로 둔다(겹침이 없고, 한 줄씩 원자적으로 쓸 수 있다).
 * - 칸마다 따로 읽고 쓸 수 있게 큰 칸(meta, wallet, bag, month …)으로 나눈다.
 */
export const CHARACTER_SCHEMA_VERSION = 1;

/** 시각: UTC 기준 1970년부터의 밀리초 */
const timestamp = z.number().int().min(0);
const keySet = z.record(KeySchema, z.literal(true)).default({});

export const LifeStageSchema = z.enum([
  "요청",
  "승인 대기",
  "기본 정하기",
  "성장기",
  "상세 설정",
  "최종 승인 대기",
  "살아 있음",
  "죽음",
]);

export const QualitySchema = z.enum(["하", "중", "상", "최상"]);
export type Quality = z.infer<typeof QualitySchema>;

export const StackSchema = z.strictObject({
  itemId: DefIdSchema,
  quantity: z.number().int().min(1),
  freshness: z.number().int().min(0).max(100),
  quality: QualitySchema,
});
export type Stack = z.infer<typeof StackSchema>;

export const UniqueItemSchema = z.strictObject({
  itemId: DefIdSchema,
  enhance: z.number().int().min(0).max(20),
  durability: z.number().int().min(0).max(100),
  quality: QualitySchema,
});
export type UniqueItem = z.infer<typeof UniqueItemSchema>;

export const BagSchema = z
  .strictObject({
    /** 묶음 물건. 키는 stackKey(물건·신선도·품질이 같으면 같은 묶음) */
    stacks: z.record(KeySchema, StackSchema).default({}),
    /** 낱개 물건. 키는 고유 ID */
    uniques: z.record(KeySchema, UniqueItemSchema).default({}),
  })
  .default({ stacks: {}, uniques: {} });
export type Bag = z.infer<typeof BagSchema>;

export const MailSchema = z.strictObject({
  /** 이때가 지나면 사라진다 */
  expiresAt: timestamp,
  stack: StackSchema.optional(),
  unique: z.strictObject({ uniqueId: KeySchema, item: UniqueItemSchema }).optional(),
});
export type Mail = z.infer<typeof MailSchema>;

/** 캐릭터 한 명. `limits`의 범위를 그대로 쓴다. */
export function characterSchema(limits: Limits) {
  const ability = z.number().int().min(limits.abilities.min).max(limits.abilities.max);
  const count = z.number().int().min(0);

  return z.strictObject({
    meta: z.strictObject({
      schemaVersion: z.literal(CHARACTER_SCHEMA_VERSION),
      /** 이 캐릭터를 가진 계정 */
      owner: z.string().min(1),
      /** 수정 번호. 값이 바뀔 때마다 1씩 오른다. 이전 값을 보고 계산한 쓰기를 거절하는 데 쓴다 */
      rev: count,
      /** 마지막으로 처리한 요청 ID */
      lastRequestId: KeySchema.optional(),
      stage: LifeStageSchema,
      createdAt: timestamp,
    }),
    profile: z.strictObject({
      name: z.string().min(1).max(40),
      gender: z.string().min(1).max(20),
      age: count.max(150),
      origin: z.strictObject({
        realm: z.enum(["제국", "팔군도", "적국"]),
        /** 태어난 지역·장소 (팔군도는 섬 이름까지) */
        region: z.string().min(1),
        place: z.string().min(1),
      }),
      /** 제국 거주민 */
      imperialResident: z.boolean(),
    }),
    abilities: z.strictObject({
      health: ability,
      spirit: ability,
      credit: ability,
      connections: ability,
      reputation: ability,
    }),
    talents: z.strictObject({
      chosen: z.array(DefIdSchema).length(limits.talents.chosen),
      innate: z.strictObject({ id: DefIdSchema, revealed: z.boolean() }).optional(),
      acquired: keySet,
      /** 얻은 재능 조건의 카운터 */
      progress: z.record(KeySchema, count).default({}),
    }),
    /** 기술(나무)별 숙련도 */
    mastery: z
      .record(
        KeySchema,
        z.strictObject({
          value: z.number().min(0).max(100).multipleOf(0.01),
          passed60: z.boolean(),
          passed80: z.boolean(),
        }),
      )
      .default({}),
    /** 나무별 찍은 칸 */
    trees: z
      .record(
        KeySchema,
        z.strictObject({
          treeVersion: z.number().int().min(1),
          picked: keySet,
          /** 고르는 보완 칸에서 고른 쪽 (0 또는 1) */
          choices: z.record(KeySchema, z.union([z.literal(0), z.literal(1)])).default({}),
          spent: z.strictObject({ branch: count, root: count }),
        }),
      )
      .default({}),
    loadout: z
      .strictObject({
        basics: z.array(DefIdSchema).max(limits.loadout.basics).default([]),
        ultimate: DefIdSchema.optional(),
        support: DefIdSchema.optional(),
        unique: DefIdSchema.optional(),
      })
      .default({ basics: [] }),
    /** 잎전 */
    wallet: count.max(limits.exchange.walletMax),
    bag: BagSchema,
    month: z.strictObject({
      /** 연도-달 순번 (예: "514-3") */
      key: z.string().regex(/^[0-9]+-(?:[0-9]|1[01])$/),
      mainActions: count.max(limits.month.mainActions),
      minorActions: count.max(limits.month.minorActions),
      savedActions: count.max(limits.month.savedActionsMax),
      career: count.max(limits.month.careerMax),
      learnCounts: z.record(KeySchema, count).default({}),
      combatMasteryGained: z.record(KeySchema, z.union([z.literal(0), z.literal(1)])).default({}),
      /** 콘텐츠 분야별 오늘의 피로 */
      fatigue: z.record(KeySchema, count).default({}),
    }),
    /** 받은 보상의 출처 ID */
    claimedRewards: keySet,
    mailbox: z.record(KeySchema, MailSchema).default({}),
  });
}
export type Character = z.infer<ReturnType<typeof characterSchema>>;
