import { z } from "zod";
import { defHeader } from "./common";

const count = z.number().int().min(0);

/**
 * 저장되는 값의 범위와 상한. 스키마·주고받기 계산·보안 규칙이 모두 이 값을 읽는다.
 * exchange의 상한은 실제 보상·가격 규모가 정해지기 전의 넉넉한 임시값이다.
 */
export const LimitsSchema = z.strictObject({
  ...defHeader,
  abilities: z.strictObject({ min: z.number().int(), max: z.number().int(), initial: z.number().int() }),
  talents: z.strictObject({ chosen: count.min(1) }),
  loadout: z.strictObject({ basics: count.min(1) }),
  month: z.strictObject({ mainActions: count, minorActions: count, savedActionsMax: count, careerMax: count }),
  /** 세계 시계: 처음 연도(성력), 하루 경계(현실 시간대의 UTC와의 차, 시간). 한국 시간 자정이면 9 */
  clock: z.strictObject({ startYear: count.min(1), utcOffsetHours: z.number().int().min(-12).max(14) }),
  exchange: z.strictObject({
    /** 지갑이 가질 수 있는 최대 (잎전) */
    walletMax: count.max(Number.MAX_SAFE_INTEGER),
    /** 한 번의 변경으로 지갑이 늘 수 있는 최대 */
    maxWalletGainPerChange: count,
    /** 한 묶음의 최대 수량 */
    maxStackQuantity: count.min(1),
    /** 한 번의 변경으로 한 묶음이 늘 수 있는 최대 */
    maxQuantityGainPerChange: count.min(1),
    /** 우편함 보관 기간(일) */
    mailboxDays: count.min(1),
  }),
});
export type Limits = z.infer<typeof LimitsSchema>;
