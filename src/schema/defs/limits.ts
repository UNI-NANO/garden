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
  /** 구역 대화: 한 줄 길이, 빨리 보내기(burstSeconds 안에 burstLines를 넘으면 muteSeconds 막힘), 들어올 때 보여 줄 줄 수, 보관 날수, 규칙이 강제하는 최소 간격 */
  chat: z.strictObject({
    maxLength: count.min(1),
    burstLines: count.min(1),
    burstSeconds: count.min(1),
    muteSeconds: count.min(1),
    historyLines: count.min(1),
    keepDays: count.min(1),
    minGapMs: count,
  }),
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
  /** 던전 탐험 (명세서 「던전」). 숫자는 모두 임시 */
  dungeon: z.strictObject({
    /** 함정방을 지날 때 내는 체력: 최대 체력의 이 비율 (체력 1은 남는다) */
    trapHpShare: z.number().min(0).max(1),
    /** 쉼터의 쉬기: 최대 체력·기력의 이 비율만큼 회복 */
    restShare: z.number().min(0).max(1),
    /** 전투가 끝난 뒤 기력: 최대 기력의 이 비율만큼 찬다 */
    fightEnergyShare: z.number().min(0).max(1),
    /** 얻은 것의 칸 수 (같은 물건 묶음은 한 칸, 잎전은 칸을 쓰지 않음) */
    lootSlots: count.min(1),
    /** 시작부터 이 시간이 지나면 자동 귀환 */
    autoReturnHours: z.number().positive(),
    /** 보상 곡선: 그날 그 분야 n번째(1부터)의 전리품 배율. 끝 값이 이후에도 이어진다 */
    fatigueCurve: z.array(z.number().min(0).max(1)).min(1),
  }),
});
export type Limits = z.infer<typeof LimitsSchema>;
