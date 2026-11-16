import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { AppliedEffectSchema } from "./effect";
import { DamageTypeSchema } from "./skill";
import { RangeSchema } from "./skill-table";

const share = z.number().min(0).max(1);
const multiplier = z.number().min(0).max(10);
const count = z.number().int().min(0);

export const ResistLevelSchema = z.enum(["강함", "보통", "약함"]);
export const ReachSchema = z.enum(["근접", "원거리"]);
export type Reach = z.infer<typeof ReachSchema>;
export const RowSchema = z.enum(["앞줄", "뒷줄"]);
export type Row = z.infer<typeof RowSchema>;

/** 전투 기준값. 전투 계산의 숫자는 모두 여기서 읽는다(기술의 숫자는 기술 기준표). 전부 임시값이다. */
export const BattleRulesSchema = z.strictObject({
  ...defHeader,
  player: z.strictObject({
    /** 최대 체력 = hpBase + 건강 × hpPerHealth */
    hpBase: z.number().min(0),
    hpPerHealth: z.number().min(0),
    defense: count,
    /** 위력 × (1 + 숙련도 × powerPerMastery) */
    powerPerMastery: z.number().min(0),
  }),
  /** 판정 바. 좋음 폭 = goodBase + 숙련도 × goodPerMastery, 완벽은 좋음의 가운데, 보통은 좋음 양옆 */
  judgementBar: z.strictObject({
    length: z.number().positive(),
    goodBase: z.number().min(0),
    goodPerMastery: z.number().min(0),
    perfectShare: share,
    normalShareEachSide: z.number().min(0),
  }),
  range: z.strictObject({
    /** 고른 대상이 아닌 나머지 대상이 받는 위력의 비율 */
    othersShare: z.record(RangeSchema, share),
    staggerOthersShare: share,
  }),
  rangedMultiplier: multiplier,
  resist: z.record(ResistLevelSchema, multiplier),
  stagger: z.strictObject({
    typeMultiplier: z.record(DamageTypeSchema, multiplier),
    /** 흐트러진 적이 받는 피해 배율 */
    damageTakenMultiplier: multiplier,
    /** 받아치기 반격의 흐트러짐 배율 */
    parryMultiplier: multiplier,
  }),
  guard: z.strictObject({ damageMultiplier: share, energy: count }),
  dodge: z.strictObject({ energy: count }),
  move: z.strictObject({ energy: count }),
  /** 적의 숫자는 등급 공식으로: 체력 = hpBase + hpPerTier × 등급, 위력 = powerBase + powerPerTier × 등급 */
  enemy: z.strictObject({
    hpBase: z.number().min(0),
    hpPerTier: z.number().min(0),
    eliteHpMultiplier: multiplier,
    staggerShare: share,
    powerBase: z.number().min(0),
    powerPerTier: z.number().min(0),
    elitePowerAdd: z.number().min(0),
  }),
  /** 한 방에 최대 체력의 이 비율 이상 맞고 쓰러지면 중상 */
  injury: z.strictObject({ severeHitShare: share }),
  /** 칸의 설명에 나오는 말의 기준값 ("판정 칸 조금 넓게" 등). 칸의 규칙은 숫자 대신 이 말을 적을 수 있다 */
  words: z.record(z.string().min(1), z.number()),
  /** 연계: 이어서 쓸 때 위력에 더하는 비율 */
  chain: z.strictObject({ linkBonus: z.number().min(0), finishBonus: z.number().min(0) }),
  /** 스스로 고르는 규칙: 체력이 이 비율 이하면 막는다 */
  auto: z.strictObject({ guardBelowHpShare: share }),
});
export type BattleRules = z.infer<typeof BattleRulesSchema>;

export const ArchetypeSchema = z.enum(["짐승", "도적", "병사", "광신도", "늪", "얼음", "벌레", "잠식된 자", "해적", "카르텔", "유물 기계"]);
export const EnemyRankSchema = z.enum(["일반", "정예", "보스"]);
/** 누구를 노리나. 원형별 성향 가운데 지금 계산이 아는 것만 */
export const TargetingSchema = z.enum(["앞줄", "뒷줄", "체력이 가장 낮은 쪽", "무작위"]);
export type Targeting = z.infer<typeof TargetingSchema>;

export const EnemyActionSchema = z.strictObject({
  name: z.string().min(1),
  damageType: DamageTypeSchema,
  reach: ReachSchema,
  range: RangeSchema,
  /** 큰 공격: 피하기로 넘길 수 있다 */
  big: z.boolean().optional(),
  /** 고를 때의 무게 */
  weight: z.number().positive(),
  /** 이 행동의 위력 = 적의 위력 × 이 값 (없으면 1) */
  powerMultiplier: multiplier.optional(),
  /** 맞은 쪽에 붙는 효과 */
  effects: z.array(AppliedEffectSchema).optional(),
});
export type EnemyAction = z.infer<typeof EnemyActionSchema>;

export const EnemySchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  archetype: ArchetypeSchema,
  tier: z.number().int().min(1).max(5),
  rank: EnemyRankSchema,
  row: RowSchema,
  resist: z.record(DamageTypeSchema, ResistLevelSchema),
  defense: count,
  targeting: TargetingSchema,
  actions: z.array(EnemyActionSchema).min(1),
  /** 걸리지 않는 효과 */
  immune: z.array(DefIdSchema).optional(),
  /** 등급 공식 대신 직접 정한 값 (튀어야 하는 적만) */
  overrides: z.strictObject({ hp: z.number().positive().optional(), stagger: z.number().positive().optional(), power: z.number().min(0).optional() }).optional(),
});
export type Enemy = z.infer<typeof EnemySchema>;

export const EnemyListSchema = z.strictObject({
  ...defHeader,
  enemies: z.array(EnemySchema),
});
export type EnemyList = z.infer<typeof EnemyListSchema>;
