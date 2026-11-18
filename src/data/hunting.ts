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
  huntGains,
  HuntingError,
  planHunt,
  replayHunt,
  type HuntAction,
  type HuntState,
} from "../rules/hunting";
import { characterSchema } from "../schema/character";
import type { HuntingDefs } from "../schema/defs/hunting";
import { KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { itemCodexWrites, planEnemyCodex } from "./codex";
import { paths } from "./paths";
import { battleTally } from "../rules/codex";

/**
 * 사냥 한 번의 저장 (8단계 ② 다). 흔적·다가가기·쏘기는 행동 기록을 다시 돌려 계산한다(판정은 눌린 자리로).
 * 위험한 짐승이 달려든 뒤의 전투 결과만 화면을 믿는다(던전과 같다).
 * 사냥 분야 피로 +1, 잡았으면 「주고받기」로(넘치면 우편함), 수정 번호·요청 기록과 한 번에. 같은 요청 ID는 한 번만.
 */

export const HUNTING_FATIGUE = "hunting";
const MAX_ACTIONS = 50;

export type HuntingCommitResult =
  | {
      status: "ok";
      state: HuntState;
      gains: { item: string; quantity: number; quality: string }[];
      mailed: string[];
    }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitHunting(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: {
    groundId: string;
    seed: string;
    actions: readonly HuntAction[];
    battleWon?: boolean;
  },
  hunting: HuntingDefs,
  ctx: ExchangeContext,
): Promise<HuntingCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const ground = hunting.grounds.find((g) => g.id === input.groundId);
  if (!ground)
    return { status: "rejected", detail: `없는 사냥터: ${input.groundId}` };
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

  const hunt = planHunt(
    input.seed,
    ground,
    seasonOf(parseMonthKey(before.month.key)?.index ?? 0),
    hunting.rules,
  );
  let state: HuntState;
  try {
    state = replayHunt(hunt, input.actions, hunting.rules);
  } catch (error) {
    if (error instanceof HuntingError)
      return { status: "rejected", detail: error.message };
    throw error;
  }
  if (state.phase !== "끝")
    return { status: "rejected", detail: "사냥이 아직 끝나지 않았다" };
  if (state.outcome === "달려듦" && input.battleWon === undefined)
    return { status: "rejected", detail: "달려든 짐승과의 전투 결과가 없다" };

  const fatigueIndex = (before.month.fatigue[HUNTING_FATIGUE] ?? 0) + 1;
  const steps = curveSteps(
    fatigueMultiplier(fatigueIndex, ctx.limits),
    ctx.limits.dungeon.fatigueCurve,
  );
  const gains = huntGains(state, hunt, hunting.rules, steps, input.battleWon);

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(`month/fatigue/${HUNTING_FATIGUE}`, fatigueIndex);

  // 달려든 짐승과 싸웠으면 적 도감에 (만남·이긴 수, 완성 보상)
  const codex =
    input.battleWon !== undefined && hunt.prey.danger
      ? await planEnemyCodex(db, characterId, battleTally(hunt.prey.danger.enemies.map((m) => m.enemy), input.battleWon), ctx.limits)
      : { writes: {}, money: 0, completed: [] };
  Object.assign(updates, codex.writes);

  let mailed: string[] = [];
  if (gains.length > 0 || codex.money > 0) {
    const items: ItemGain[] = gains.map((g) => ({
      kind: "묶음",
      itemId: g.item,
      quantity: g.quantity,
      freshness: 100,
      quality: g.quality,
    }));
    const exchange = applyExchange(
      {
        wallet: before.wallet,
        bag: before.bag,
        claimedRewards: before.claimedRewards,
        mailbox: before.mailbox,
      },
      {
        requestId,
        reason: `사냥 ${ground.name} · ${hunt.prey.name}`,
        walletDelta: codex.money,
        gains: items,
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
    if (exchange.next.wallet !== before.wallet) set("wallet", exchange.next.wallet);
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
    kind: "사냥",
  });

  Object.assign(updates, await itemCodexWrites(db, characterId, requestId, updates, ctx.now));
  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", state, gains, mailed };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
