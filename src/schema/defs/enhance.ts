import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 강화 (명세서 「가방·신선도·제작·강화」 → 강화, 강화표는 사용자 기획서 「강화 (최대 +10)」).
 * 단계마다 성공 확률·오르는 힘·비용. 돈·재료 숫자는 임시.
 */

const count = z.number().int().min(0);
const percent = z.number().min(0).max(100);

export const EnhanceStepSchema = z.strictObject({
  /** 이 단계로 오를 성공 확률 (%) */
  chance: percent,
  /** 이 단계에서 오르는 힘 (피해 %) */
  power: z.number().min(0),
  money: count,
  materials: z.array(
    z.strictObject({ item: DefIdSchema, quantity: count.min(1) }),
  ),
});
export type EnhanceStep = z.infer<typeof EnhanceStepSchema>;

export const EnhanceDefsSchema = z.strictObject({
  ...defHeader,
  /** +1 ~ +10 (순서대로) */
  steps: z.array(EnhanceStepSchema).length(10),
  fail: z.strictObject({
    /** 실패하면 낼 돈의 비율 (재료는 늘 전부) */
    moneyShare: z.number().min(0).max(1),
    /** 이 단계를 노리다 실패하면 내려갈 수 있다 */
    dropFrom: z.number().int().min(1).max(10),
    /** 내려갈 확률 (%) */
    dropChance: percent,
    /** 연속 실패마다 더하는 성공 확률 (%) */
    pityPerFail: z.number().min(0),
  }),
  /** 내려감을 막는 부적 (막을 때 하나 쓴다) */
  charm: DefIdSchema,
  /** 대장장이 대사 */
  lines: z.strictObject({
    fail: z.string(),
    warnFrom: z.number().int().min(1).max(10),
    warn: z.string(),
    max: z.string(),
  }),
  /** 단계를 이룬 표시: 이 단계 → 문구 */
  milestones: z.record(z.string().regex(/^(?:[1-9]|10)$/), z.string().min(1)),
  /** +10의 이름 앞에 붙는 말 */
  maxTitle: z.string().min(1),
});
export type EnhanceDefs = z.infer<typeof EnhanceDefsSchema>;
