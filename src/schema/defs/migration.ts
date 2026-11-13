import { z } from "zod";
import { defHeader } from "./common";

const mastery = z.number().min(0).max(100);

/** 옛 데이터를 새 기준으로 옮기는 규칙. 한 번만 쓰지만 숫자는 여기 한곳에 둔다. */
export const MigrationSchema = z.strictObject({
  ...defHeader,
  /** 옛 숙련도 구간 → 새 숙련도 구간. 구간 안에서는 비례로 옮긴다 */
  masteryCurve: z
    .array(z.strictObject({ oldFrom: mastery, oldTo: mastery, newFrom: mastery, newTo: mastery }))
    .min(1),
});
export type Migration = z.infer<typeof MigrationSchema>;
