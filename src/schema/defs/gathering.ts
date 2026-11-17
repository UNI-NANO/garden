import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { SeasonSchema } from "./fishing";

/**
 * 채집 (기획서 「사냥·채집·낚시」: 지도 위 지점에서 캐기 + 비슷한 독초 가려내기). 숫자는 모두 임시.
 * 약초마다 닮은 독초가 있고, 생김새 단서 셋(줄기 색·잎 가장자리·잎 뒤 색)으로 가려낸다. 잎 뒤는 「잎 뒤 보기」로만 보인다.
 */

const count = z.number().int().min(0);
const range = z
  .strictObject({ min: count.min(1), max: count.min(1) })
  .refine((r) => r.min <= r.max, "min ≤ max 여야 한다");
const QualitySchema = z.enum(["하", "중", "상", "최상"]);

export const TellsSchema = z.strictObject({
  stem: z.enum(["연두", "자주", "갈색"]),
  edge: z.enum(["매끈", "톱니", "갈라짐"]),
  back: z.enum(["은빛", "붉음", "연두", "솜털"]),
});
export type Tells = z.infer<typeof TellsSchema>;

export const HerbSchema = z.strictObject({
  /** 약초 물건 ID (묶음 물건) */
  item: DefIdSchema,
  seasons: z.array(SeasonSchema).min(1),
  weight: z.number().positive(),
  /** 한 포기에서 얻는 수량 */
  quantity: range,
  tells: TellsSchema,
  /** 닮은 독초. 없으면 귀한 풀(드물게 나온다) */
  lookalike: z
    .strictObject({ name: z.string().min(1), tells: TellsSchema })
    .optional(),
});
export type Herb = z.infer<typeof HerbSchema>;

export const GatheringSpotSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  region: z.string().min(1),
  place: z.string().min(1),
  description: z.string(),
  herbs: z.array(HerbSchema).min(1),
});
export type GatheringSpot = z.infer<typeof GatheringSpotSchema>;

export const GatheringRulesSchema = z.strictObject({
  /** 한 번 나갈 때 비탈에 나는 풀 수 */
  plants: range,
  /** 닮은 독초의 비율, 귀한 풀이 하나 섞일 확률 */
  lookalikeShare: z.number().min(0).max(1),
  rareChance: z.number().min(0).max(1),
  /** 비가 올 때까지의 시간(칸)과 행동마다 드는 시간 */
  time: count.min(1),
  cost: z.strictObject({
    back: count,
    quick: count.min(1),
    careful: count.min(1),
  }),
  /** 캐는 방법과 잎 뒤를 봤는지에 따른 품질 */
  quality: z.strictObject({
    quick: QualitySchema,
    quickChecked: QualitySchema,
    careful: QualitySchema,
    carefulChecked: QualitySchema,
  }),
});
export type GatheringRules = z.infer<typeof GatheringRulesSchema>;

export const GatheringDefsSchema = z.strictObject({
  ...defHeader,
  rules: GatheringRulesSchema,
  spots: z.array(GatheringSpotSchema).min(1),
});
export type GatheringDefs = z.infer<typeof GatheringDefsSchema>;
