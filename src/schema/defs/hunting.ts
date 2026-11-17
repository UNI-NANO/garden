import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { SeasonSchema } from "./fishing";

/**
 * 사냥 (기획서 「사냥·채집·낚시」: 흔적 추적 → 짧은 전투나 한 발 사격). 숫자는 모두 임시.
 */

const count = z.number().int().min(0);
const range = z
  .strictObject({ min: count.min(1), max: count.min(1) })
  .refine((r) => r.min <= r.max, "min ≤ max 여야 한다");
const share = z.number().min(0).max(1);
const QualitySchema = z.enum(["하", "중", "상", "최상"]);

/** 흔적 단서 하나 (갈림길의 길마다 하나가 보인다) */
export const TrackSchema = z.enum([
  "작은 발자국",
  "갈라진 발굽",
  "넓은 발굽",
  "파헤친 흙",
  "꺾인 풀",
  "똥 무더기",
]);
export type Track = z.infer<typeof TrackSchema>;

export const PreySchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  seasons: z.array(SeasonSchema).min(1),
  weight: z.number().positive(),
  /** 예민함 (0~1). 클수록 다가갈 때 경계가 빨리 오른다 */
  wariness: share,
  /** 이 짐승의 흔적 (맞는 길에는 이 가운데 하나가 보인다) */
  tracks: z.array(TrackSchema).min(1),
  /** 잡으면 얻는 것 (묶음 물건) */
  drops: z.array(z.strictObject({ item: DefIdSchema, quantity: range })).min(1),
  /** 위험한 짐승: 스치면 달려들어 이 적들과 싸운다 */
  danger: z
    .strictObject({
      enemies: z
        .array(
          z.strictObject({
            enemy: DefIdSchema,
            slot: z.number().int().min(0).max(5),
          }),
        )
        .min(1),
    })
    .optional(),
});
export type Prey = z.infer<typeof PreySchema>;

export const HuntingGroundSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  region: z.string().min(1),
  place: z.string().min(1),
  description: z.string(),
  prey: z.array(PreySchema).min(1),
});
export type HuntingGround = z.infer<typeof HuntingGroundSchema>;

export const HuntingRulesSchema = z.strictObject({
  /** 흔적 갈림길 수 (다 맞히면 짐승이 보인다), 갈림길마다 길 수 */
  forks: count.min(1),
  paths: range,
  /** 쓸 수 있는 걸음 (갈림길에서 길 하나 고르기 = 한 걸음, 「빠르게」는 반 걸음) */
  steps: count.min(1),
  /** 경계 오름 (0~100에 더함): 조용히, 빠르게, 틀린 길, 바람을 등지고 갈 때 더 */
  alert: z.strictObject({
    quiet: count,
    fast: count,
    wrong: count,
    downwind: count,
    approach: count,
  }),
  /** 처음 보일 때 거리(m), 「더 다가가기」 한 번에 줄어드는 거리, 가장 가까운 거리 */
  distance: z.strictObject({
    start: z.number().positive(),
    step: z.number().positive(),
    min: z.number().positive(),
  }),
  /** 판정 바 (길이 100): 가장 먼 거리와 가장 가까운 거리에서 칸 폭, 커서가 지나가는 시간 */
  bar: z.strictObject({
    far: z.strictObject({
      good: z.number().min(0),
      perfect: z.number().min(0),
      normalEachSide: z.number().min(0),
    }),
    near: z.strictObject({
      good: z.number().min(0),
      perfect: z.number().min(0),
      normalEachSide: z.number().min(0),
    }),
    sweepMs: z.number().positive(),
  }),
  /** 품질: 판정과 쏠 때 경계(이 값 이상이면 한 단계 낮음) */
  quality: z.strictObject({
    완벽: QualitySchema,
    좋음: QualitySchema,
    전투: QualitySchema,
    nervousAlert: count,
  }),
});
export type HuntingRules = z.infer<typeof HuntingRulesSchema>;

export const HuntingDefsSchema = z.strictObject({
  ...defHeader,
  rules: HuntingRulesSchema,
  grounds: z.array(HuntingGroundSchema).min(1),
});
export type HuntingDefs = z.infer<typeof HuntingDefsSchema>;
