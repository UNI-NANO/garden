import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 제작 (명세서 「가방·신선도·제작·강화」 → 제작). 작업장과 레시피, 품질 공식의 기준값. 숫자는 모두 임시.
 */

const count = z.number().int().min(0);
const share = z.number().min(0).max(1);

export const StationSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 품질에 반영하는 숙련 기술 (없으면 재료 등급과 미니게임만) */
  mastery: DefIdSchema.optional(),
  /** 타이밍 미니게임: 이름(망치질 등), 판정 바를 치는 횟수, 칸 폭(길이 100), 커서가 지나가는 시간 */
  game: z.strictObject({
    name: z.string().min(1),
    hits: count.min(1),
    widths: z.strictObject({
      good: z.number().min(0),
      perfect: z.number().min(0),
      normalEachSide: z.number().min(0),
    }),
    sweepMs: z.number().positive(),
  }),
});
export type Station = z.infer<typeof StationSchema>;

const Amount = z.strictObject({ item: DefIdSchema, quantity: count.min(1) });

export const RecipeSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  station: DefIdSchema,
  inputs: z.array(Amount).min(1),
  output: Amount,
  /** 처음부터 아는 레시피 */
  known: z.boolean(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const CraftingRulesSchema = z.strictObject({
  /** 판정 하나의 점수 (0~1) */
  score: z.strictObject({
    완벽: share,
    좋음: share,
    보통: share,
    빗나감: share,
  }),
  /** 품질 점수의 무게: 미니게임, 재료 등급, 숙련도 (숙련 기술이 없는 작업장은 앞의 둘만, 무게를 다시 나눈다) */
  weights: z.strictObject({
    game: z.number().min(0),
    material: z.number().min(0),
    mastery: z.number().min(0),
  }),
  /** 품질 점수(0~1) 기준: 이 값 이상이면 최상·상·중, 나머지는 하 */
  quality: z.strictObject({ 최상: share, 상: share, 중: share }),
  /** 조합 시도가 틀리면 넣은 재료 종류마다 잃는 비율 (내림, 최소 1) */
  combineLoss: share,
});
export type CraftingRules = z.infer<typeof CraftingRulesSchema>;

export const CraftingDefsSchema = z.strictObject({
  ...defHeader,
  rules: CraftingRulesSchema,
  stations: z.array(StationSchema).min(1),
  recipes: z.array(RecipeSchema).min(1),
});
export type CraftingDefs = z.infer<typeof CraftingDefsSchema>;
