import { z } from "zod";
import {
  craftQuality,
  CraftingError,
  gameScore,
  knowsRecipe,
  materialGrade,
  pickStacks,
  recipeByName,
  tryCombine,
  type Taken,
} from "../rules/crafting";
import {
  applyExchange,
  type ExchangeContext,
  type ItemGain,
  type ItemLoss,
} from "../rules/exchange";
import { characterSchema, type Quality } from "../schema/character";
import type { CraftingDefs } from "../schema/defs/crafting";
import type { Judgement } from "../schema/defs/skill-table";
import { idToKey, KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { paths } from "./paths";

/**
 * 제작의 저장 (명세서 「가방·신선도·제작·강화」 → 제작). 재료 빼기와 결과 넣기를 「주고받기」 한 번에.
 * 판정(미니게임)은 화면을 믿는다(낚시와 같다). 품질은 판정·쓴 재료·숙련도로 여기서 다시 계산한다.
 * 저장할 때마다 보류 목록의 [레시피 이름] 장면 결과를 먼저 배운다.
 */

export type CraftCommitResult =
  | {
      status: "ok";
      quality?: Quality;
      learned?: string;
      lost?: { item: string; quantity: number }[];
      mailed: string[];
    }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

type Ctx = ExchangeContext;

async function readParts(db: DbPort, characterId: string, ctx: Ctx) {
  const shape = characterSchema(ctx.limits).shape;
  const names = [
    "meta/rev",
    "wallet",
    "bag",
    "claimedRewards",
    "mailbox",
    "recipes",
    "pendingResults",
    "mastery",
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
      recipes: shape.recipes,
      pending: shape.pendingResults,
      mastery: shape.mastery,
    })
    .safeParse({
      rev: value("meta/rev"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
      recipes: value("recipes"),
      pending: value("pendingResults"),
      mastery: value("mastery"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`,
    );
  return { ...read.data, shape };
}

/** 보류된 [레시피 이름]을 배운 레시피로 옮긴다. 정의에 없는 이름은 보류에 남긴다 */
function absorbPending(
  before: Awaited<ReturnType<typeof readParts>>,
  crafting: CraftingDefs,
) {
  const learned: Record<string, true> = { ...before.recipes };
  const pending = before.pending.filter((p) => {
    if (p.cmd !== "레시피") return true;
    const recipe = recipeByName(p.args[0] ?? "", crafting.recipes);
    if (!recipe) return true;
    learned[idToKey(recipe.id)] = true;
    return false;
  });
  return {
    learned,
    pending,
    changed: pending.length !== before.pending.length,
  };
}

function begin(
  characterId: string,
  requestId: string,
  before: Awaited<ReturnType<typeof readParts>>,
  crafting: CraftingDefs,
) {
  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  const absorbed = absorbPending(before, crafting);
  if (absorbed.changed) {
    set("pendingResults", before.shape.pendingResults.parse(absorbed.pending));
    for (const key of Object.keys(absorbed.learned))
      if (!before.recipes[key]) set(`recipes/${key}`, true);
  }
  return { updates, set, learned: absorbed.learned };
}

async function finish(
  db: DbPort,
  characterId: string,
  requestId: string,
  updates: Record<string, unknown>,
  now: number,
): Promise<"ok" | "duplicate" | "conflict"> {
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({
    at: now,
    kind: "제작",
  });
  if ((await db.update(updates)) === "ok") return "ok";
  return (await db.get(paths.request(characterId, requestId))) != null
    ? "duplicate"
    : "conflict";
}

function applyBag(
  set: (name: string, v: unknown) => void,
  updates: Record<string, unknown>,
  characterId: string,
  before: Awaited<ReturnType<typeof readParts>>,
  exchange: Extract<ReturnType<typeof applyExchange>, { ok: true }>,
) {
  diff(before.bag.stacks, exchange.next.bag.stacks, (key, v) =>
    set(`bag/stacks/${key}`, v),
  );
  diff(before.bag.uniques, exchange.next.bag.uniques, (key, v) =>
    set(`bag/uniques/${key}`, v),
  );
  diff(before.mailbox, exchange.next.mailbox, (key, v) =>
    set(`mailbox/${key}`, v),
  );
  updates[paths.ledger(characterId, exchange.ledger.requestId)] =
    LedgerLineSchema.parse(exchange.ledger);
}

/** 아는 레시피로 만든다: 재료(신선도 낮은 것부터)를 빼고 결과를 넣는다. 결과의 품질은 판정·재료·숙련도로 */
export async function commitCraft(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: { recipeId: string; judgements: readonly Judgement[] },
  crafting: CraftingDefs,
  ctx: Ctx,
): Promise<CraftCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const recipe = crafting.recipes.find((r) => r.id === input.recipeId);
  const station =
    recipe && crafting.stations.find((s) => s.id === recipe.station);
  if (!recipe || !station)
    return { status: "rejected", detail: `없는 레시피: ${input.recipeId}` };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };
  const before = await readParts(db, characterId, ctx);
  const { updates, set, learned } = begin(
    characterId,
    requestId,
    before,
    crafting,
  );
  if (!knowsRecipe(recipe, learned))
    return { status: "rejected", detail: "모르는 레시피" };

  let game: number;
  try {
    game = gameScore(input.judgements, station, crafting.rules);
  } catch (error) {
    if (error instanceof CraftingError)
      return { status: "rejected", detail: error.message };
    throw error;
  }
  const taken: Taken[] = [];
  for (const need of recipe.inputs) {
    const picked = pickStacks(before.bag, need.item, need.quantity);
    if (!picked)
      return { status: "rejected", detail: `재료가 모자란다: ${need.item}` };
    taken.push(...picked);
  }
  const mastery = station.mastery
    ? before.mastery[idToKey(station.mastery)]?.value
    : undefined;
  const quality = craftQuality(
    {
      game,
      material: materialGrade(taken),
      ...(mastery !== undefined ? { mastery } : {}),
    },
    station,
    crafting.rules,
  );

  const single = ctx.items.get(recipe.output.item)?.kind === "낱개";
  const gains: ItemGain[] = single
    ? Array.from({ length: recipe.output.quantity }, (_, i) => ({
        kind: "낱개" as const,
        uniqueId: `${requestId}-${i}`,
        item: {
          itemId: recipe.output.item,
          enhance: 0,
          durability: 100,
          quality,
        },
      }))
    : [
        {
          kind: "묶음",
          itemId: recipe.output.item,
          quantity: recipe.output.quantity,
          freshness: 100,
          quality,
        },
      ];
  const losses: ItemLoss[] = taken.map((t) => ({
    kind: "묶음",
    stackKey: t.stackKey,
    quantity: t.quantity,
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
      reason: `제작 ${recipe.name}`,
      walletDelta: 0,
      gains,
      losses,
      overflow: "우편함",
    },
    ctx,
  );
  if (!exchange.ok)
    return {
      status: "rejected",
      detail: `${exchange.reason}: ${exchange.detail}`,
    };
  applyBag(set, updates, characterId, before, exchange);

  const written = await finish(db, characterId, requestId, updates, ctx.now);
  return written === "ok"
    ? { status: "ok", quality, mailed: exchange.mailed }
    : { status: written };
}

/** 조합 시도: 맞으면 레시피를 배우고(재료는 그대로), 틀리면 넣은 재료 종류마다 일부를 잃는다 */
export async function commitCombine(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: {
    stationId: string;
    inputs: readonly { item: string; quantity: number }[];
  },
  crafting: CraftingDefs,
  ctx: Ctx,
): Promise<CraftCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  if (!crafting.stations.some((s) => s.id === input.stationId))
    return { status: "rejected", detail: `없는 작업장: ${input.stationId}` };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };
  const before = await readParts(db, characterId, ctx);
  const { updates, set, learned } = begin(
    characterId,
    requestId,
    before,
    crafting,
  );

  let result;
  try {
    result = tryCombine(
      input.stationId,
      input.inputs,
      crafting.recipes,
      crafting.rules,
    );
  } catch (error) {
    if (error instanceof CraftingError)
      return { status: "rejected", detail: error.message };
    throw error;
  }
  // 넣은 만큼 가지고 있어야 한다
  for (const i of input.inputs)
    if (!pickStacks(before.bag, i.item, i.quantity))
      return { status: "rejected", detail: `재료가 모자란다: ${i.item}` };

  if (result.kind === "배움") {
    if (knowsRecipe(result.recipe, learned))
      return {
        status: "rejected",
        detail: `이미 아는 레시피: ${result.recipe.name}`,
      };
    set(`recipes/${idToKey(result.recipe.id)}`, true);
    const written = await finish(db, characterId, requestId, updates, ctx.now);
    return written === "ok"
      ? { status: "ok", learned: result.recipe.id, mailed: [] }
      : { status: written };
  }

  const losses: ItemLoss[] = result.losses.flatMap((loss) =>
    pickStacks(before.bag, loss.item, loss.quantity)!.map((t) => ({
      kind: "묶음" as const,
      stackKey: t.stackKey,
      quantity: t.quantity,
    })),
  );
  const exchange = applyExchange(
    {
      wallet: before.wallet,
      bag: before.bag,
      claimedRewards: before.claimedRewards,
      mailbox: before.mailbox,
    },
    {
      requestId,
      reason: "조합 시도 (실패)",
      walletDelta: 0,
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
  applyBag(set, updates, characterId, before, exchange);
  const written = await finish(db, characterId, requestId, updates, ctx.now);
  return written === "ok"
    ? { status: "ok", lost: result.losses, mailed: [] }
    : { status: written };
}
