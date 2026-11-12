import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { EffectWeightSchema } from "./skill-table";

export const EffectSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 효과 예산에서 차지하는 무게 */
  weight: EffectWeightSchema,
});
export type Effect = z.infer<typeof EffectSchema>;

export const EffectListSchema = z.strictObject({
  ...defHeader,
  effects: z.array(EffectSchema),
});
export type EffectList = z.infer<typeof EffectListSchema>;
