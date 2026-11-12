import type { Bag, Mail, Quality, Stack, UniqueItem } from "../schema/character";
import type { Item } from "../schema/defs/item";
import type { Limits } from "../schema/defs/limits";
import { idToKey, KEY_PATTERN } from "../schema/keys";

/**
 * 주고받기 공통 규칙 (명세서). 돈·물건이 바뀌는 모든 일은 이 계산을 거친다.
 * 바뀔 값을 모두 미리 계산하고, 하나라도 어기면 아무것도 바꾸지 않는다.
 * 순수 함수라서 화면과 하루 계산이 같은 결과를 낸다.
 */

/** 주고받기가 읽고 바꾸는 캐릭터의 칸 */
export interface ExchangeState {
  wallet: number;
  bag: Bag;
  claimedRewards: Record<string, true>;
  mailbox: Record<string, Mail>;
}

export type ItemGain =
  | { kind: "묶음"; itemId: string; quantity: number; freshness: number; quality: Quality }
  | { kind: "낱개"; uniqueId: string; item: UniqueItem };

export type ItemLoss = { kind: "묶음"; stackKey: string; quantity: number } | { kind: "낱개"; uniqueId: string };

export interface ExchangeChange {
  requestId: string;
  /** 왜 바뀌는지 (장부에 남는 출처) */
  reason: string;
  /** 보상이면 출처 ID. 같은 보상은 한 번만 받는다 */
  rewardId?: string | undefined;
  /** 지갑에 더할 값 (잎전, 쓰면 음수) */
  walletDelta: number;
  gains: readonly ItemGain[];
  losses: readonly ItemLoss[];
  /** 짐 한도를 넘는 몫을 어떻게 할지. 보상은 우편함으로, 구매 같은 것은 거절 */
  overflow: "우편함" | "거절";
}

export interface ExchangeContext {
  /** 지금 시각 (UTC 밀리초) */
  now: number;
  limits: Limits;
  /** 물건 ID → 카드 */
  items: ReadonlyMap<string, Item>;
  /** 짐 무게 한도 (맨몸 한도 + 탈것 한도) */
  carryLimit: number;
}

export interface LedgerItem {
  itemId: string;
  /** 늘면 양수, 줄면 음수 */
  delta: number;
  where: "가방" | "우편함";
}

/** 장부 한 줄 */
export interface LedgerLine {
  at: number;
  requestId: string;
  reason: string;
  rewardId?: string;
  walletDelta: number;
  walletAfter: number;
  items: LedgerItem[];
}

export type ExchangeFailure =
  | "잘못된 요청"
  | "돈 부족"
  | "지갑 한도 초과"
  | "한 번에 늘 수 있는 양 초과"
  | "없는 물건"
  | "모르는 물건"
  | "이미 가진 낱개 물건"
  | "이미 받은 보상"
  | "짐 한도 초과"
  | "보관 기간이 지남";

export type ExchangeResult =
  | { ok: true; next: ExchangeState; ledger: LedgerLine; mailed: string[] }
  | { ok: false; reason: ExchangeFailure; detail: string };

const MS_PER_DAY = 86_400_000;
const fail = (reason: ExchangeFailure, detail: string): ExchangeResult => ({ ok: false, reason, detail });

/** 물건·신선도·품질이 같으면 같은 묶음이다 */
export function stackKeyOf(itemId: string, freshness: number, quality: Quality): string {
  const q = { 하: 0, 중: 1, 상: 2, 최상: 3 }[quality];
  return `${idToKey(itemId)}-f${freshness}-q${q}`;
}

/** 짐의 무게 합. 모르는 물건이 있으면 undefined */
export function bagWeight(bag: Bag, items: ReadonlyMap<string, Item>): number | undefined {
  let total = 0;
  for (const stack of Object.values(bag.stacks)) {
    const item = items.get(stack.itemId);
    if (item === undefined) return undefined;
    total += item.weight * stack.quantity;
  }
  for (const unique of Object.values(bag.uniques)) {
    const item = items.get(unique.itemId);
    if (item === undefined) return undefined;
    total += item.weight;
  }
  return total;
}

function cloneState(state: ExchangeState): ExchangeState {
  return structuredClone(state);
}

/** 한 번의 변경을 계산한다. 원래 state는 건드리지 않는다. */
export function applyExchange(state: ExchangeState, change: ExchangeChange, ctx: ExchangeContext): ExchangeResult {
  const { limits, items } = ctx;
  const cap = limits.exchange;

  // 요청 모양
  if (!KEY_PATTERN.test(change.requestId)) return fail("잘못된 요청", "요청 ID의 모양이 틀리다");
  if (change.reason.length === 0) return fail("잘못된 요청", "출처가 비어 있다");
  if (!Number.isSafeInteger(change.walletDelta)) return fail("잘못된 요청", "돈은 정수여야 한다");
  if (change.walletDelta === 0 && change.gains.length === 0 && change.losses.length === 0) {
    return fail("잘못된 요청", "바뀌는 것이 없다");
  }

  const next = cloneState(state);
  const ledgerItems: LedgerItem[] = [];
  const mailed: string[] = [];

  // 보상: 같은 출처는 한 번만
  let rewardKey: string | undefined;
  if (change.rewardId !== undefined) {
    rewardKey = idToKey(change.rewardId);
    if (!KEY_PATTERN.test(rewardKey)) return fail("잘못된 요청", "보상 출처 ID의 모양이 틀리다");
    if (next.claimedRewards[rewardKey] === true) return fail("이미 받은 보상", change.rewardId);
    next.claimedRewards[rewardKey] = true;
  }

  // 지갑
  if (change.walletDelta > cap.maxWalletGainPerChange) {
    return fail("한 번에 늘 수 있는 양 초과", `돈 +${change.walletDelta}`);
  }
  const wallet = next.wallet + change.walletDelta;
  if (wallet < 0) return fail("돈 부족", `${next.wallet} 있음, ${-change.walletDelta} 필요`);
  if (wallet > cap.walletMax) return fail("지갑 한도 초과", `${wallet}`);
  next.wallet = wallet;

  // 빠지는 물건 먼저
  for (const loss of change.losses) {
    if (loss.kind === "묶음") {
      if (!Number.isSafeInteger(loss.quantity) || loss.quantity < 1) return fail("잘못된 요청", "수량은 1 이상의 정수여야 한다");
      const stack = next.bag.stacks[loss.stackKey];
      if (stack === undefined || stack.quantity < loss.quantity) return fail("없는 물건", loss.stackKey);
      if (stack.quantity === loss.quantity) delete next.bag.stacks[loss.stackKey];
      else stack.quantity -= loss.quantity;
      ledgerItems.push({ itemId: stack.itemId, delta: -loss.quantity, where: "가방" });
    } else {
      const unique = next.bag.uniques[loss.uniqueId];
      if (unique === undefined) return fail("없는 물건", loss.uniqueId);
      delete next.bag.uniques[loss.uniqueId];
      ledgerItems.push({ itemId: unique.itemId, delta: -1, where: "가방" });
    }
  }

  // 들어오는 물건
  const weightNow = bagWeight(next.bag, items);
  if (weightNow === undefined) return fail("모르는 물건", "가방에 정의 데이터에 없는 물건이 있다");
  let room = ctx.carryLimit - weightNow;
  const expiresAt = ctx.now + cap.mailboxDays * MS_PER_DAY;
  let mailIndex = 0;
  const mail = (content: Pick<Mail, "stack" | "unique">, itemId: string, quantity: number) => {
    const mailId = `${change.requestId}-${mailIndex++}`;
    next.mailbox[mailId] = { expiresAt, ...content };
    mailed.push(mailId);
    ledgerItems.push({ itemId, delta: quantity, where: "우편함" });
  };

  for (const gain of change.gains) {
    const itemId = gain.kind === "묶음" ? gain.itemId : gain.item.itemId;
    const item = items.get(itemId);
    if (item === undefined) return fail("모르는 물건", itemId);
    if (item.kind !== gain.kind) return fail("잘못된 요청", `${itemId}은(는) ${item.kind} 물건이다`);

    if (gain.kind === "묶음") {
      if (!Number.isSafeInteger(gain.quantity) || gain.quantity < 1) return fail("잘못된 요청", "수량은 1 이상의 정수여야 한다");
      if (!Number.isInteger(gain.freshness) || gain.freshness < 0 || gain.freshness > 100) {
        return fail("잘못된 요청", "신선도는 0~100의 정수여야 한다");
      }
      if (gain.quantity > cap.maxQuantityGainPerChange) return fail("한 번에 늘 수 있는 양 초과", `${itemId} +${gain.quantity}`);

      // 무게가 허락하는 만큼만 가방으로
      const fits = item.weight === 0 ? gain.quantity : Math.min(gain.quantity, Math.max(0, Math.floor(room / item.weight)));
      const over = gain.quantity - fits;
      if (over > 0 && change.overflow === "거절") return fail("짐 한도 초과", itemId);

      if (fits > 0) {
        const key = stackKeyOf(itemId, gain.freshness, gain.quality);
        const quantity = (next.bag.stacks[key]?.quantity ?? 0) + fits;
        if (quantity > cap.maxStackQuantity) return fail("한 번에 늘 수 있는 양 초과", `${itemId} 묶음이 ${quantity}`);
        next.bag.stacks[key] = { itemId, quantity, freshness: gain.freshness, quality: gain.quality };
        room -= fits * item.weight;
        ledgerItems.push({ itemId, delta: fits, where: "가방" });
      }
      if (over > 0) {
        const stack: Stack = { itemId, quantity: over, freshness: gain.freshness, quality: gain.quality };
        mail({ stack }, itemId, over);
      }
    } else {
      if (!KEY_PATTERN.test(gain.uniqueId)) return fail("잘못된 요청", "낱개 물건 ID의 모양이 틀리다");
      const inMail = Object.values(next.mailbox).some((m) => m.unique?.uniqueId === gain.uniqueId);
      if (next.bag.uniques[gain.uniqueId] !== undefined || inMail) return fail("이미 가진 낱개 물건", gain.uniqueId);
      if (item.weight <= room) {
        next.bag.uniques[gain.uniqueId] = { ...gain.item };
        room -= item.weight;
        ledgerItems.push({ itemId, delta: 1, where: "가방" });
      } else if (change.overflow === "거절") {
        return fail("짐 한도 초과", itemId);
      } else {
        mail({ unique: { uniqueId: gain.uniqueId, item: { ...gain.item } } }, itemId, 1);
      }
    }
  }

  const ledger: LedgerLine = {
    at: ctx.now,
    requestId: change.requestId,
    reason: change.reason,
    ...(change.rewardId !== undefined ? { rewardId: change.rewardId } : {}),
    walletDelta: change.walletDelta,
    walletAfter: next.wallet,
    items: ledgerItems,
  };
  return { ok: true, next, ledger, mailed };
}

/**
 * 우편함에서 한 건을 꺼내 가방에 넣는다. 짐 한도를 넘으면 꺼낼 수 없다(일부만 꺼내지 않는다).
 */
export function claimMail(
  state: ExchangeState,
  input: { requestId: string; mailId: string },
  ctx: ExchangeContext,
): ExchangeResult {
  const mailItem = state.mailbox[input.mailId];
  if (mailItem === undefined) return fail("없는 물건", input.mailId);
  if (mailItem.expiresAt <= ctx.now) return fail("보관 기간이 지남", input.mailId);

  const without: ExchangeState = cloneState(state);
  delete without.mailbox[input.mailId];

  const gains: ItemGain[] = [];
  if (mailItem.stack !== undefined) gains.push({ kind: "묶음", ...mailItem.stack });
  if (mailItem.unique !== undefined) gains.push({ kind: "낱개", uniqueId: mailItem.unique.uniqueId, item: mailItem.unique.item });
  if (gains.length === 0) return fail("없는 물건", input.mailId);

  // 우편함에 들어올 때 이미 상한을 지났으므로, 꺼낼 때는 한 번에 늘 수 있는 양을 다시 따지지 않는다
  const limits: Limits = {
    ...ctx.limits,
    exchange: { ...ctx.limits.exchange, maxQuantityGainPerChange: ctx.limits.exchange.maxStackQuantity },
  };
  const result = applyExchange(
    without,
    { requestId: input.requestId, reason: "우편함에서 꺼냄", walletDelta: 0, gains, losses: [], overflow: "거절" },
    { ...ctx, limits },
  );
  if (!result.ok) return result;
  // 우편함에서 빠진 것도 장부에 남긴다
  for (const gain of gains) {
    const itemId = gain.kind === "묶음" ? gain.itemId : gain.item.itemId;
    result.ledger.items.push({ itemId, delta: gain.kind === "묶음" ? -gain.quantity : -1, where: "우편함" });
  }
  return result;
}
