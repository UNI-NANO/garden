import { z } from "zod";
import { DefIdSchema } from "./defs/common";
import { KeySchema } from "./keys";

/** 장부 한 줄: 언제, 무엇이, 얼마나, 왜, 요청 ID. (누구인지는 저장 경로의 캐릭터 ID) */
export const LedgerLineSchema = z.strictObject({
  at: z.number().int().min(0),
  requestId: KeySchema,
  reason: z.string().min(1),
  rewardId: z.string().min(1).optional(),
  walletDelta: z.number().int(),
  walletAfter: z.number().int().min(0),
  items: z
    .array(
      z.strictObject({
        itemId: DefIdSchema,
        delta: z.number().int(),
        where: z.enum(["가방", "우편함"]),
      }),
    )
    .default([]),
});

/** 처리한 요청의 기록. 같은 요청 ID가 다시 오면 이 기록이 있어서 두 번 처리되지 않는다. */
export const RequestRecordSchema = z.strictObject({
  at: z.number().int().min(0),
  kind: z.enum(["주고받기"]),
});
