import { z } from "zod";
import { parseMonthKey, seasonOf } from "../rules/calendar";
import { fatigueMultiplier } from "../rules/dungeon/end";
import {
  applyExchange,
  type ExchangeContext,
  type ItemGain,
} from "../rules/exchange";
import { curveSteps } from "../rules/fishing";
import {
  GatheringError,
  planField,
  replayGathering,
  type GatherAction,
  type GatherState,
} from "../rules/gathering";
import { characterSchema } from "../schema/character";
import type { GatheringDefs } from "../schema/defs/gathering";
import { KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { paths } from "./paths";

/**
 * 채집 한 번(비탈 하나)의 저장 (8단계 ② 나). 행동 기록을 다시 돌려 캔 것을 계산하므로 화면의 결과를 믿지 않아도 된다.
 * 채집 분야 피로 +1, 캔 약초는 「주고받기」로(넘치면 우편함), 수정 번호·요청 기록과 한 번에. 같은 요청 ID는 한 번만.
 */

export const GATHERING_FATIGUE = "gathering";
const MAX_ACTIONS = 100;

export type GatheringCommitResult =
  | { status: "ok"; result: GatherState; mailed: string[] }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitGathering(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: { spotId: string; seed: string; actions: readonly GatherAction[] },
  gathering: GatheringDefs,
  ctx: ExchangeContext,
): Promise<GatheringCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const spot = gathering.spots.find((s) => s.id === input.spotId);
  if (!spot)
    return { status: "rejected", detail: `없는 채집터: ${input.spotId}` };
  if (input.actions.length > MAX_ACTIONS)
    return { status: "rejected", detail: "행동이 너무 많다" };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };

  const shape = characterSchema(ctx.limits).shape;
  const names = [
    "meta/rev",
    "month",
    "wallet",
    "bag",
    "claimedRewards",
    "mailbox",
  ] as const;
  const raw = await Promise.all(
    names.map((name) => db.get(paths.characterPart(characterId, name))),
  );
  const value = (name: (typeof names)[number]) =>
    raw[names.indexOf(name)] ?? undefined;
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      month: shape.month,
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
    })
    .safeParse({
      rev: value("meta/rev"),
      month: value("month"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`,
    );
  const before = read.data;

  const fatigueIndex = (before.month.fatigue[GATHERING_FATIGUE] ?? 0) + 1;
  const steps = curveSteps(
    fatigueMultiplier(fatigueIndex, ctx.limits),
    ctx.limits.dungeon.fatigueCurve,
  );
  const field = planField(
    input.seed,
    spot,
    seasonOf(parseMonthKey(before.month.key)?.index ?? 0),
    gathering.rules,
  );
  let result: GatherState;
  try {
    result = replayGathering(field, input.actions, gathering.rules, steps);
  } catch (error) {
    if (error instanceof GatheringError)
      return { status: "rejected", detail: error.message };
    throw error;
  }

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(`month/fatigue/${GATHERING_FATIGUE}`, fatigueIndex);

  let mailed: string[] = [];
  if (result.gains.length > 0) {
    // 같은 약초·품질은 한 묶음으로
    const merged = new Map<string, Extract<ItemGain, { kind: "묶음" }>>();
    for (const gain of result.gains) {
      const key = `${gain.item}|${gain.quality}`;
      const same = merged.get(key);
      if (same) same.quantity += gain.quantity;
      else
        merged.set(key, {
          kind: "묶음",
          itemId: gain.item,
          quantity: gain.quantity,
          freshness: 100,
          quality: gain.quality,
        });
    }
    const exchange = applyExchange(
      {
        wallet: before.wallet,
        bag: before.bag,
        claimedRewards: before.claimedRewards,
        mailbox: before.mailbox,
      },
      {
        requestId,
        reason: `채집 ${spot.name}`,
        walletDelta: 0,
        gains: [...merged.values()],
        losses: [],
        overflow: "우편함",
      },
      ctx,
    );
    if (!exchange.ok)
      return {
        status: "rejected",
        detail: `${exchange.reason}: ${exchange.detail}`,
      };
    mailed = exchange.mailed;
    diff(before.bag.stacks, exchange.next.bag.stacks, (key, v) =>
      set(`bag/stacks/${key}`, v),
    );
    diff(before.bag.uniques, exchange.next.bag.uniques, (key, v) =>
      set(`bag/uniques/${key}`, v),
    );
    diff(before.mailbox, exchange.next.mailbox, (key, v) =>
      set(`mailbox/${key}`, v),
    );
    updates[paths.ledger(characterId, requestId)] = LedgerLineSchema.parse(
      exchange.ledger,
    );
  }
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({
    at: ctx.now,
    kind: "채집",
  });

  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", result, mailed };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
