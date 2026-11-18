import { z } from "zod";
import { parseMonthKey, seasonOf } from "../rules/calendar";
import { fatigueMultiplier } from "../rules/dungeon/end";
import { applyExchange, type ExchangeContext } from "../rules/exchange";
import { catchQuality, curveSteps, planCast } from "../rules/fishing";
import { characterSchema, type Quality } from "../schema/character";
import type { FishingDefs } from "../schema/defs/fishing";
import { KEY_PATTERN, idToKey } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { itemCodexWrites } from "./codex";
import { paths } from "./paths";

/**
 * 낚시 한 번의 저장 (8단계 ② 낚시). 낚시 분야 피로 +1, 낚았으면 물고기를 「주고받기」로(넘치면 우편함),
 * 내 최고 기록을 수정 번호·요청 기록과 한 번에. 놓쳐도 피로는 오른다. 같은 요청 ID는 한 번만.
 * 무엇이 무는지·크기는 씨앗과 던진 힘으로 다시 계산한다. 채는 정확함·팽팽함은 화면의 결과를 믿는다(장면·던전과 같다).
 */

export const FISHING_FATIGUE = "fishing";

export type FishingOutcome =
  | { kind: "낚음"; accuracy: number; maxTension: number }
  | { kind: "놓침" | "끊어짐" | "빠져나감" };

export type FishingCommitResult =
  | {
      status: "ok";
      caught?: {
        item: string;
        size: number;
        quality: Quality;
        record: boolean;
      };
      mailed: string[];
    }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitFishing(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: {
    spotId: string;
    seed: string;
    power: number;
    outcome: FishingOutcome;
  },
  fishing: FishingDefs,
  ctx: ExchangeContext,
): Promise<FishingCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const spot = fishing.spots.find((s) => s.id === input.spotId);
  if (!spot)
    return { status: "rejected", detail: `없는 낚시터: ${input.spotId}` };
  if (!(input.power >= 0 && input.power <= 1))
    return { status: "rejected", detail: "던지기 힘은 0~1" };
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
    "records",
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
      records: shape.records,
    })
    .safeParse({
      rev: value("meta/rev"),
      month: value("month"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
      records: value("records"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`,
    );
  const before = read.data;

  const fatigueIndex = (before.month.fatigue[FISHING_FATIGUE] ?? 0) + 1;
  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(`month/fatigue/${FISHING_FATIGUE}`, fatigueIndex);

  let caught: Extract<FishingCommitResult, { status: "ok" }>["caught"];
  let mailed: string[] = [];
  if (input.outcome.kind === "낚음") {
    const season = seasonOf(parseMonthKey(before.month.key)?.index ?? 0);
    const cast = planCast(input.seed, input.power, spot, season, fishing.rules);
    const steps = curveSteps(
      fatigueMultiplier(fatigueIndex, ctx.limits),
      ctx.limits.dungeon.fatigueCurve,
    );
    const quality = catchQuality(
      input.outcome.accuracy,
      input.outcome.maxTension,
      steps,
      fishing.rules,
    );
    const recordKey = idToKey(cast.fish.item);
    const best = before.records.fish[recordKey];
    const record = best === undefined || cast.size > best;
    if (record) set(`records/fish/${recordKey}`, cast.size);
    caught = { item: cast.fish.item, size: cast.size, quality, record };

    const exchange = applyExchange(
      {
        wallet: before.wallet,
        bag: before.bag,
        claimedRewards: before.claimedRewards,
        mailbox: before.mailbox,
      },
      {
        requestId,
        reason: `낚시 ${spot.name}`,
        walletDelta: 0,
        gains: [
          {
            kind: "묶음",
            itemId: cast.fish.item,
            quantity: 1,
            freshness: 100,
            quality,
          },
        ],
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
    kind: "낚시",
  });

  Object.assign(updates, await itemCodexWrites(db, characterId, requestId, updates, ctx.now));
  const written = await db.update(updates);
  if (written === "ok")
    return { status: "ok", ...(caught ? { caught } : {}), mailed };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
