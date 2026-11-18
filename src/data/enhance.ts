import { z } from "zod";
import { pickStacks } from "../rules/crafting";
import {
  enhanceRoll,
  EnhanceError,
  MAX_ENHANCE,
  nextStep,
  type EnhanceRoll,
} from "../rules/enhance";
import {
  applyExchange,
  type ExchangeContext,
  type ItemLoss,
} from "../rules/exchange";
import { characterSchema, UniqueItemSchema } from "../schema/character";
import type { EnhanceDefs } from "../schema/defs/enhance";
import { KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { paths } from "./paths";

/**
 * 강화 한 번의 저장. 씨앗 = 요청 ID라 결과가 정해진 채 한 번에 쓴다(명세서: 끊겨도 다시 굴릴 수 없음).
 * 돈(성공이면 전부, 실패면 일부)·재료 전부·(막았으면) 부적 하나를 빼고, 낱개 물건의 단계와 연속 실패 수를 바꾼다.
 * 돈과 재료는 미리 다 있어야 맡길 수 있다.
 */

export type EnhanceCommitResult =
  | { status: "ok"; roll: EnhanceRoll; before: number }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitEnhance(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: { uniqueId: string; useCharm: boolean },
  enhance: EnhanceDefs,
  ctx: ExchangeContext,
): Promise<EnhanceCommitResult> {
  if (
    !KEY_PATTERN.test(characterId) ||
    !KEY_PATTERN.test(requestId) ||
    !KEY_PATTERN.test(input.uniqueId)
  ) {
    return { status: "rejected", detail: "ID의 모양이 틀리다" };
  }
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };
  const shape = characterSchema(ctx.limits).shape;
  const names = [
    "meta/rev",
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
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
    })
    .safeParse({
      rev: value("meta/rev"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""}`,
    );
  const before = read.data;

  const unique = before.bag.uniques[input.uniqueId];
  if (!unique) return { status: "rejected", detail: "가방에 없는 물건" };
  if (!ctx.items.get(unique.itemId)?.enhanceable)
    return { status: "rejected", detail: "강화할 수 없는 물건" };
  if (unique.enhance >= MAX_ENHANCE)
    return { status: "rejected", detail: "이미 +10이다" };
  let step;
  try {
    step = nextStep(unique.enhance, enhance);
  } catch (error) {
    if (error instanceof EnhanceError)
      return { status: "rejected", detail: error.message };
    throw error;
  }
  if (before.wallet < step.money)
    return { status: "rejected", detail: "돈이 모자란다" };
  const materialLosses: ItemLoss[] = [];
  for (const m of step.materials) {
    const picked = pickStacks(before.bag, m.item, m.quantity);
    if (!picked)
      return { status: "rejected", detail: `재료가 모자란다: ${m.item}` };
    materialLosses.push(
      ...picked.map((t) => ({
        kind: "묶음" as const,
        stackKey: t.stackKey,
        quantity: t.quantity,
      })),
    );
  }
  const charm = input.useCharm
    ? pickStacks(before.bag, enhance.charm, 1)
    : undefined;
  if (input.useCharm && !charm)
    return { status: "rejected", detail: "부적이 없다" };

  const roll = enhanceRoll(
    requestId,
    unique.enhance,
    unique.failStreak ?? 0,
    input.useCharm,
    enhance,
  );
  const losses = [
    ...materialLosses,
    ...(roll.charmUsed && charm
      ? charm.map((t) => ({
          kind: "묶음" as const,
          stackKey: t.stackKey,
          quantity: t.quantity,
        }))
      : []),
  ];
  const exchange = applyExchange(
    {
      wallet: before.wallet,
      bag: before.bag,
      claimedRewards: before.claimedRewards,
      mailbox: before.mailbox,
    },
    {
      requestId,
      reason: `강화 ${unique.itemId} +${unique.enhance + 1} ${roll.success ? "성공" : "실패"}`,
      walletDelta: -roll.money,
      gains: [],
      losses,
      overflow: "거절",
    },
    ctx,
  );
  if (!exchange.ok)
    return {
      status: "rejected",
      detail: `${exchange.reason}: ${exchange.detail}`,
    };
  const nextUnique = {
    ...unique,
    enhance: roll.level,
    failStreak: roll.failStreak,
  };
  const nextBag = {
    ...exchange.next.bag,
    uniques: {
      ...exchange.next.bag.uniques,
      [input.uniqueId]: UniqueItemSchema.parse(nextUnique),
    },
  };

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  if (exchange.next.wallet !== before.wallet)
    set("wallet", exchange.next.wallet);
  diff(before.bag.stacks, nextBag.stacks, (key, v) =>
    set(`bag/stacks/${key}`, v),
  );
  diff(before.bag.uniques, nextBag.uniques, (key, v) =>
    set(`bag/uniques/${key}`, v),
  );
  updates[paths.ledger(characterId, requestId)] = LedgerLineSchema.parse(
    exchange.ledger,
  );
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({
    at: ctx.now,
    kind: "강화",
  });

  if ((await db.update(updates)) === "ok")
    return { status: "ok", roll, before: unique.enhance };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
