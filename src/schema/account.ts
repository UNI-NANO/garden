import { z } from "zod";
import { KeySchema } from "./keys";

/** 계정: 로그인하는 사람. `/accounts/{uid}` */
export const AccountSchema = z.strictObject({
  displayName: z.string().max(80).default(""),
  /** 처음 들어온 때 (UTC 밀리초) */
  createdAt: z.number().int().min(0),
  /** 마지막으로 들어온 때 */
  lastSeenAt: z.number().int().min(0),
  /** 연결된 캐릭터. GM만 잇는다. 계정당 살아 있는 캐릭터는 하나 */
  characterId: KeySchema.optional(),
});
export type Account = z.infer<typeof AccountSchema>;

/** 화면에서 난 오류 한 줄. `/errors/{id}` — GM 패널에서 본다 */
export const ErrorRecordSchema = z.strictObject({
  at: z.number().int().min(0),
  uid: z.string().min(1),
  message: z.string().min(1).max(2000),
  /** 어느 화면·어느 동작에서 */
  where: z.string().max(200).optional(),
  detail: z.string().max(4000).optional(),
});
export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;
