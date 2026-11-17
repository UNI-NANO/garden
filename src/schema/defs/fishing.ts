import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 낚시 (기획서 「사냥·채집·낚시」: 찌 타이밍 + 줄 당기기). 낚시터와 물고기 표, 씨름 숫자. 숫자는 모두 임시.
 */

const count = z.number().int().min(0);
const range = (schema: z.ZodNumber) =>
  z
    .strictObject({ min: schema, max: schema })
    .refine((r) => r.min <= r.max, "min ≤ max 여야 한다");

export const SeasonSchema = z.enum(["봄", "여름", "가을", "겨울"]);
export type Season = z.infer<typeof SeasonSchema>;

export const CAST_ZONES = ["얕은 곳", "갈대 사이", "깊은 곳"] as const;
export type CastZone = (typeof CAST_ZONES)[number];

export const FishSchema = z.strictObject({
  /** 물고기 물건 ID (묶음 물건) */
  item: DefIdSchema,
  seasons: z.array(SeasonSchema).min(1),
  weight: z.number().positive(),
  /** 크기 (cm) */
  size: range(z.number().positive()),
  /** 평소 당기는 힘 (0~1). 클수록 감을 때 팽팽함이 빨리 오르고, 풀 때 줄이 빨리 나간다 */
  pull: z.number().min(0).max(1),
  /** 차고 나가기 횟수 */
  surges: range(count),
});
export type Fish = z.infer<typeof FishSchema>;

export const FishingSpotSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  region: z.string().min(1),
  place: z.string().min(1),
  description: z.string(),
  zones: z.strictObject({
    "얕은 곳": z.array(FishSchema).min(1),
    "갈대 사이": z.array(FishSchema).min(1),
    "깊은 곳": z.array(FishSchema).min(1),
  }),
});
export type FishingSpot = z.infer<typeof FishingSpotSchema>;

export const FishingRulesSchema = z.strictObject({
  /** 던지기 힘이 이 값 미만이면 얕은 곳, 그다음 값 미만이면 갈대 사이, 나머지는 깊은 곳 */
  zoneEdges: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  /** 누르고 있을 때 힘 막대가 0→1→0 한 바퀴 도는 시간 */
  castCycleMs: z.number().positive(),
  /** 기다리기: 처음 입질까지, 톡톡(가짜 입질) 횟수와 사이, 푹 잠긴 뒤 채야 하는 틈 */
  firstWaitMs: range(z.number().positive()),
  nibbles: range(count),
  nibbleGapMs: range(z.number().positive()),
  biteWindowMs: z.number().positive(),
  /** 씨름: 줄 길이(m), 시작 거리 = 가까운 거리 + 힘 × (먼 거리 − 가까운 거리) */
  lineLength: z.number().positive(),
  startDistance: range(z.number().positive()),
  /** 감기 빠르기(m/초), 풀 때 나가는 빠르기(m/초, 당기는 힘을 곱함) */
  reelSpeed: z.number().positive(),
  payoutSpeed: z.number().positive(),
  /** 감을 때 팽팽함이 오르는 빠르기(1초에, 당기는 힘을 곱함), 풀 때 내리는 빠르기 */
  tensionUp: z.number().positive(),
  tensionDown: z.number().positive(),
  /** 차고 나가기: 처음 시각, 사이, 예고, 길이, 그동안 당기는 힘 배율과 감을 때 더 오르는 팽팽함 */
  surgeFirstMs: range(z.number().positive()),
  surgeGapMs: range(z.number().positive()),
  surgeWarnMs: z.number().positive(),
  surgeMs: z.number().positive(),
  surgePullMultiplier: z.number().min(1),
  surgeTensionUp: z.number().positive(),
  /** 품질 점수(0~1) 기준: 이 값 이상이면 최상·상·중, 나머지는 하 */
  quality: z.strictObject({
    최상: z.number().min(0).max(1),
    상: z.number().min(0).max(1),
    중: z.number().min(0).max(1),
  }),
});
export type FishingRules = z.infer<typeof FishingRulesSchema>;

export const FishingDefsSchema = z.strictObject({
  ...defHeader,
  rules: FishingRulesSchema,
  spots: z.array(FishingSpotSchema).min(1),
});
export type FishingDefs = z.infer<typeof FishingDefsSchema>;
