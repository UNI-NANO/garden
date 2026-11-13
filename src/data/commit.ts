import { z } from "zod";
import type { ExchangeContext, ExchangeResult, ExchangeState, ExchangeFailure, LedgerLine } from "../rules/exchange";
import { characterSchema } from "../schema/character";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { KEY_PATTERN } from "../schema/keys";
import { paths } from "./paths";

/**
 * 데이터베이스에 닿는 최소한의 창구. 실제 Firebase와 테스트(에뮬레이터)가 같은 코드를 쓰게 한다.
 * update는 여러 경로를 한 번에 쓴다: 다 되거나 하나도 안 된다.
 */
export interface DbPort {
  get(path: string): Promise<unknown>;
  /** 경로 → 값(null이면 지움). 보안 규칙이 막으면 "denied" */
  update(updates: Record<string, unknown>): Promise<"ok" | "denied">;
}

export type CommitResult =
  /** 저장됨 */
  | { status: "ok"; ledger: LedgerLine; mailed: string[] }
  /** 이미 처리한 요청. 그때의 결과를 그대로 돌려준다 */
  | { status: "duplicate"; ledger: LedgerLine }
  /** 규칙을 어겨 아무것도 바꾸지 않음 */
  | { status: "rejected"; reason: ExchangeFailure; detail: string }
  /** 그 사이 다른 곳에서 값이 바뀜. 새로 읽고 다시 해야 한다 */
  | { status: "conflict" };

export class CommitError extends Error {
  override name = "CommitError";
}

/**
 * 주고받기 한 번을 저장한다 (명세서 「한 번의 변경」).
 * 1. 요청 ID가 이미 처리됐으면 그때 결과를 돌려준다.
 * 2. 지금 값을 읽어 바뀔 값을 모두 미리 계산한다.
 * 3. 하나라도 어기면 아무것도 쓰지 않는다.
 * 4. 통과하면 지갑·가방·받은 보상·우편함·수정 번호·요청 기록·장부를 한 번에 쓴다.
 */
export async function commitExchange(
  db: DbPort,
  characterId: string,
  requestId: string,
  compute: (state: ExchangeState) => ExchangeResult,
  ctx: Pick<ExchangeContext, "limits" | "now">,
): Promise<CommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId)) {
    return { status: "rejected", reason: "잘못된 요청", detail: "캐릭터 ID나 요청 ID의 모양이 틀리다" };
  }
  const shape = characterSchema(ctx.limits).shape;
  const part = (name: string) => db.get(paths.characterPart(characterId, name));

  const duplicate = await readProcessed(db, characterId, requestId);
  if (duplicate) return duplicate;

  const [rawRev, rawWallet, rawBag, rawClaimed, rawMailbox] = await Promise.all([
    part("meta/rev"),
    part("wallet"),
    part("bag"),
    part("claimedRewards"),
    part("mailbox"),
  ]);
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
    })
    .safeParse({
      rev: rawRev,
      wallet: rawWallet,
      bag: rawBag ?? undefined,
      claimedRewards: rawClaimed ?? undefined,
      mailbox: rawMailbox ?? undefined,
    });
  if (!read.success) {
    throw new CommitError(`캐릭터 ${characterId}의 저장된 값이 스키마와 다르다: ${read.error.issues[0]?.message ?? ""}`);
  }
  const { rev, ...state } = read.data;

  const result = compute(state);
  if (!result.ok) return { status: "rejected", reason: result.reason, detail: result.detail };
  if (result.ledger.requestId !== requestId) throw new CommitError("계산 결과의 요청 ID가 다르다");

  // 저장 전 검사: 새 값이 모두 스키마를 통과해야 한다
  const next = z
    .strictObject({ wallet: shape.wallet, bag: shape.bag, claimedRewards: shape.claimedRewards, mailbox: shape.mailbox })
    .safeParse(result.next);
  const ledger = LedgerLineSchema.safeParse(result.ledger);
  if (!next.success || !ledger.success) {
    const issue = (next.success ? undefined : next.error.issues[0]) ?? (ledger.success ? undefined : ledger.error.issues[0]);
    throw new CommitError(`저장하려는 값이 스키마와 다르다: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`);
  }

  const updates: Record<string, unknown> = {};
  const set = (name: string, value: unknown) => {
    updates[paths.characterPart(characterId, name)] = value;
  };
  set("meta/rev", rev + 1);
  set("meta/lastRequestId", requestId);
  if (next.data.wallet !== state.wallet) set("wallet", next.data.wallet);
  diff(state.bag.stacks, next.data.bag.stacks, (key, value) => set(`bag/stacks/${key}`, value));
  diff(state.bag.uniques, next.data.bag.uniques, (key, value) => set(`bag/uniques/${key}`, value));
  diff(state.claimedRewards, next.data.claimedRewards, (key, value) => set(`claimedRewards/${key}`, value));
  diff(state.mailbox, next.data.mailbox, (key, value) => set(`mailbox/${key}`, value));
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({ at: ctx.now, kind: "주고받기" });
  updates[paths.ledger(characterId, requestId)] = ledger.data;

  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", ledger: ledger.data, mailed: result.mailed };

  // 거절됨: 같은 요청이 방금 다른 곳에서 처리됐거나, 그 사이 값이 바뀌었다
  return (await readProcessed(db, characterId, requestId)) ?? { status: "conflict" };
}

async function readProcessed(db: DbPort, characterId: string, requestId: string): Promise<CommitResult | undefined> {
  const record = await db.get(paths.request(characterId, requestId));
  if (record === null || record === undefined) return undefined;
  const ledger = LedgerLineSchema.safeParse(await db.get(paths.ledger(characterId, requestId)));
  if (!ledger.success) throw new CommitError(`요청 ${requestId}의 장부 기록을 읽지 못했다`);
  return { status: "duplicate", ledger: ledger.data };
}

/** 바뀐 키만 골라낸다. 사라진 키는 null(지움). */
function diff<T>(before: Record<string, T>, after: Record<string, T>, emit: (key: string, value: T | null) => void): void {
  for (const key of Object.keys(before)) if (!(key in after)) emit(key, null);
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) emit(key, value);
  }
}
