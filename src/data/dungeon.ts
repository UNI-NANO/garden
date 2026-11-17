import { z } from "zod";
import { autoReturnDue, fatigueMultiplier, firstClearGains, settle, type Settlement } from "../rules/dungeon/end";
import { startExpedition, type Expedition, type Gain } from "../rules/dungeon/explore";
import { generateFloor } from "../rules/dungeon/floor";
import { applyExchange, type ExchangeContext, type ItemGain } from "../rules/exchange";
import { characterSchema } from "../schema/character";
import type { Dungeon } from "../schema/defs/dungeon";
import { ExpeditionSchema, fromStored, toStored } from "../schema/expedition";
import { KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { paths } from "./paths";

/**
 * 던전 탐험의 저장 (명세서 「던전」). 혼자 탐험만.
 * - 들어가기: 탐험 기록 만들기 + 탐험 분야 피로 +1 을 수정 번호·요청 기록과 함께 한 번에.
 * - 진행 저장: 방을 옮기거나 주울 때마다 탐험 기록만 덮어쓴다(같은 탐험 ID일 때만. 돈·물건은 아직 가방에 없다).
 * - 끝내기: 얻은 것을 「주고받기」로 가방에(넘치면 우편함), 첫 클리어 보상, 일생 한 줄, 탐험 기록 지우기를 한 번에.
 */

/** 피로를 세는 콘텐츠 분야 키 (명세서 용어집 「콘텐츠 분야」의 탐험) */
export const EXPLORE_FATIGUE = "explore";

export type DungeonCommitResult =
  | { status: "ok" }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export const expeditionPath = (characterId: string) => paths.characterPart(characterId, "expedition");
export const firstClearRewardId = (dungeonId: string) => `dungeon_first_${dungeonId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** 저장된 탐험을 읽는다. 없으면 undefined, 모양이 틀리면 오류 */
export async function readExpedition(db: DbPort, characterId: string): Promise<{ id: string; state: Expedition } | undefined> {
  const raw = await db.get(expeditionPath(characterId));
  if (raw === null || raw === undefined) return undefined;
  const parsed = ExpeditionSchema.safeParse(raw);
  if (!parsed.success) throw new CommitError(`캐릭터 ${characterId}의 탐험 기록이 스키마와 다르다: ${parsed.error.issues[0]?.path.join(".") ?? ""}`);
  return fromStored(parsed.data);
}

export interface EnterInput {
  dungeon: Dungeon;
  /** 층 지도의 씨앗 (보통 요청 ID) */
  seed: string;
  maxHp: number;
  maxEnergy: number;
}

/** 던전에 들어간다. 이미 탐험 중이면 거절 */
export async function enterDungeon(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: EnterInput,
  ctx: Pick<ExchangeContext, "limits" | "items" | "now">,
): Promise<DungeonCommitResult & { expedition?: Expedition }> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId)) return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  if ((await db.get(paths.request(characterId, requestId))) != null) return { status: "duplicate" };
  const shape = characterSchema(ctx.limits).shape;
  const [rawRev, rawFatigue, rawExpedition] = await Promise.all([
    db.get(paths.characterPart(characterId, "meta/rev")),
    db.get(paths.characterPart(characterId, "month/fatigue")),
    db.get(expeditionPath(characterId)),
  ]);
  if (rawExpedition !== null && rawExpedition !== undefined) return { status: "rejected", detail: "이미 탐험 중이다" };
  const read = z.strictObject({ rev: shape.meta.shape.rev, fatigue: shape.month.shape.fatigue }).safeParse({ rev: rawRev, fatigue: rawFatigue ?? undefined });
  if (!read.success) throw new CommitError(`캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.message ?? ""}`);

  const fatigueIndex = (read.data.fatigue[EXPLORE_FATIGUE] ?? 0) + 1;
  const firstFloor = generateFloor(input.dungeon, 1, input.seed, ctx.items, fatigueMultiplier(fatigueIndex, ctx.limits));
  const expedition = startExpedition({
    dungeonId: input.dungeon.id,
    seed: input.seed,
    now: ctx.now,
    fatigueIndex,
    maxHp: input.maxHp,
    maxEnergy: input.maxEnergy,
    firstFloor,
  });
  const written = await db.update({
    [paths.characterPart(characterId, "meta/rev")]: read.data.rev + 1,
    [paths.characterPart(characterId, "meta/lastRequestId")]: requestId,
    [paths.characterPart(characterId, `month/fatigue/${EXPLORE_FATIGUE}`)]: fatigueIndex,
    [expeditionPath(characterId)]: toStored(requestId, expedition),
    [paths.request(characterId, requestId)]: RequestRecordSchema.parse({ at: ctx.now, kind: "던전" }),
  });
  if (written === "ok") return { status: "ok", expedition };
  return (await db.get(paths.request(characterId, requestId))) != null ? { status: "duplicate" } : { status: "conflict" };
}

/** 진행을 저장한다 (같은 탐험일 때만). 끝난 상태도 저장해 두고, 정산은 finishExpedition이 한다 */
export async function saveExpedition(db: DbPort, characterId: string, id: string, state: Expedition): Promise<"ok" | "denied"> {
  return db.update({ [expeditionPath(characterId)]: toStored(id, state) });
}

/** 얻은 것 → 「주고받기」의 지갑 변화와 물건 */
export function gainsToExchange(gains: readonly Gain[], uniquePrefix: string): { walletDelta: number; items: ItemGain[] } {
  let walletDelta = 0;
  const items: ItemGain[] = [];
  gains.forEach((gain, i) => {
    if (gain.kind === "잎전") walletDelta += gain.quantity;
    else if (gain.kind === "묶음") items.push({ kind: "묶음", itemId: gain.item, quantity: gain.quantity, freshness: 100, quality: "중" });
    else items.push({ kind: "낱개", uniqueId: `${uniquePrefix}-${i}`, item: { itemId: gain.item, enhance: 0, durability: 100, quality: "중" } });
  });
  return { walletDelta, items };
}

export type FinishResult = (DungeonCommitResult & { settlement?: Settlement; firstClear?: boolean; mailed?: string[] }) | { status: "none" };

/**
 * 끝난 탐험을 정산한다: 귀환·보스는 전부, 전멸은 절반을 잃고, 하루가 지난 탐험은 자동 귀환(전부).
 * 아직 탐험 중이고 하루가 안 지났으면 거절.
 */
export async function finishExpedition(
  db: DbPort,
  characterId: string,
  requestId: string,
  dungeons: ReadonlyMap<string, Dungeon>,
  ctx: ExchangeContext,
): Promise<FinishResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId)) return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  if ((await db.get(paths.request(characterId, requestId))) != null) return { status: "duplicate" };
  const found = await readExpedition(db, characterId);
  if (!found) return { status: "none" };
  const { state } = found;
  const auto = autoReturnDue(state, ctx.now, ctx.limits);
  if (state.status === "탐험" && !auto) return { status: "rejected", detail: "아직 탐험 중이다" };
  const status = auto ? "귀환" : state.status;
  const dungeon = dungeons.get(state.dungeonId);
  if (!dungeon) throw new CommitError(`정의에 없는 던전: ${state.dungeonId}`);

  const shape = characterSchema(ctx.limits).shape;
  const names = ["meta/rev", "wallet", "bag", "claimedRewards", "mailbox", "life", "month/key"] as const;
  const raw = await Promise.all(names.map((name) => db.get(paths.characterPart(characterId, name))));
  const value = (name: (typeof names)[number]) => raw[names.indexOf(name)] ?? undefined;
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
      life: shape.life,
      monthKey: shape.month.shape.key.optional(),
    })
    .safeParse({
      rev: value("meta/rev"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
      life: value("life"),
      monthKey: value("month/key"),
    });
  if (!read.success) throw new CommitError(`캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`);
  const before = read.data;

  const settlement = settle({ status, gains: state.gains }, ctx.items);
  const rewardId = firstClearRewardId(dungeon.id);
  const firstClear = status === "보스" && before.claimedRewards[rewardId] !== true;
  const kept = [...settlement.kept, ...(firstClear ? firstClearGains(dungeon, ctx.items) : [])];
  const { walletDelta, items } = gainsToExchange(kept, `${requestId}`);

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set("expedition", null);
  const ending = { 귀환: auto ? "하루가 지나 자동 귀환" : "쉼터에서 귀환", 보스: "보스를 쓰러뜨리고 귀환", 전멸: "쓰러져 쫓겨남", 탐험: "" }[status];
  const line = shape.life.parse([
    {
      kind: "던전",
      ...(before.monthKey ? { when: before.monthKey } : {}),
      text: `${dungeon.name} ${state.floor}층: ${ending}${settlement.lost.length > 0 ? " (얻은 것의 절반을 잃음)" : ""}`,
    },
  ])[0];
  set(`life/${before.life.length}`, line);

  let mailed: string[] = [];
  if (walletDelta !== 0 || items.length > 0) {
    const exchange = applyExchange(
      { wallet: before.wallet, bag: before.bag, claimedRewards: before.claimedRewards, mailbox: before.mailbox },
      { requestId, reason: `던전 ${dungeon.name}`, ...(firstClear ? { rewardId } : {}), walletDelta, gains: items, losses: [], overflow: "우편함" },
      ctx,
    );
    if (!exchange.ok) return { status: "rejected", detail: `${exchange.reason}: ${exchange.detail}` };
    mailed = exchange.mailed;
    if (exchange.next.wallet !== before.wallet) set("wallet", exchange.next.wallet);
    diff(before.bag.stacks, exchange.next.bag.stacks, (key, v) => set(`bag/stacks/${key}`, v));
    diff(before.bag.uniques, exchange.next.bag.uniques, (key, v) => set(`bag/uniques/${key}`, v));
    diff(before.claimedRewards, exchange.next.claimedRewards, (key, v) => set(`claimedRewards/${key}`, v));
    diff(before.mailbox, exchange.next.mailbox, (key, v) => set(`mailbox/${key}`, v));
    updates[paths.ledger(characterId, requestId)] = LedgerLineSchema.parse(exchange.ledger);
  }
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({ at: ctx.now, kind: "던전" });

  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", settlement, firstClear, mailed };
  return (await db.get(paths.request(characterId, requestId))) != null ? { status: "duplicate" } : { status: "conflict" };
}
