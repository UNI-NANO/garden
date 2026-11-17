import { z } from "zod";
import { spendAction, type ActionKind, type SpendFailure } from "../rules/world-clock";
import { characterSchema, type Character } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import { KEY_PATTERN } from "../schema/keys";
import { RequestRecordSchema } from "../schema/ledger";
import { WORLD_CLOCK_PATH, WorldClockSchema } from "../schema/world";
import { CommitError, type DbPort } from "./commit";
import { paths } from "./paths";

export type MonthActionResult =
  /** 썼다 */
  | { status: "ok"; month: Character["month"]; used: { saved: number; main: number; minor: number } }
  /** 이미 처리한 요청 */
  | { status: "duplicate" }
  /** 규칙에 맞지 않아 아무것도 바꾸지 않음. "달이 다름"이면 화면을 새로 읽어야 한다 */
  | { status: "rejected"; reason: SpendFailure | "잘못된 요청" }
  /** 그 사이 값이 바뀜. 새로 읽고 다시 */
  | { status: "conflict" };

/**
 * 달 행동 하나를 쓴다 (명세서 「세계 시계와 달 행동」 행동 쓰기).
 * 요청에 붙은 이번 달 키가 세계의 달과 다르거나 계산 중이면 거절한다. 저장 행동부터 쓴다.
 * 달 칸·수정 번호·요청 기록을 한 번에 쓴다(다 되거나 하나도 안 된다). 같은 요청 ID는 한 번만.
 * 행동의 결과(배우기·일하기·쉬기)는 그 시스템이 생기면 같은 쓰기에 더한다.
 */
export async function commitMonthAction(
  db: DbPort,
  characterId: string,
  requestId: string,
  request: { monthKey: string; kind: ActionKind },
  ctx: { limits: Limits; now: number },
): Promise<MonthActionResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId)) return { status: "rejected", reason: "잘못된 요청" };
  if ((await db.get(paths.request(characterId, requestId))) != null) return { status: "duplicate" };

  const shape = characterSchema(ctx.limits).shape;
  const [rawClock, rawRev, rawMonth] = await Promise.all([
    db.get(WORLD_CLOCK_PATH),
    db.get(paths.characterPart(characterId, "meta/rev")),
    db.get(paths.characterPart(characterId, "month")),
  ]);
  const clock = WorldClockSchema.safeParse(rawClock);
  if (!clock.success) throw new CommitError("세계 시계를 읽지 못했다");
  const read = z.strictObject({ rev: shape.meta.shape.rev, month: shape.month }).safeParse({ rev: rawRev, month: rawMonth });
  if (!read.success) throw new CommitError(`캐릭터 ${characterId}의 달 칸이 스키마와 다르다: ${read.error.issues[0]?.message ?? ""}`);

  const spent = spendAction(read.data.month, clock.data, request.monthKey, request.kind);
  if (!spent.ok) return { status: "rejected", reason: spent.reason };
  const month = shape.month.parse(spent.month);

  const written = await db.update({
    [paths.characterPart(characterId, "month")]: month,
    [paths.characterPart(characterId, "meta/rev")]: read.data.rev + 1,
    [paths.characterPart(characterId, "meta/lastRequestId")]: requestId,
    [paths.request(characterId, requestId)]: RequestRecordSchema.parse({ at: ctx.now, kind: "달 행동" }),
  });
  if (written === "ok") return { status: "ok", month, used: spent.used };
  return (await db.get(paths.request(characterId, requestId))) != null ? { status: "duplicate" } : { status: "conflict" };
}
