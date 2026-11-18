import { z } from "zod";
import { fatigueMultiplier } from "../rules/dungeon/end";
import { applyExchange, type ExchangeContext } from "../rules/exchange";
import { raidGains, raidWeek, type Contribution } from "../rules/raid";
import { characterSchema } from "../schema/character";
import type { RaidDefs } from "../schema/defs/raid";
import { KEY_PATTERN, idToKey } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { RaidRecordSchema, type RaidRecord } from "../schema/raid";
import { CommitError, diff, type DbPort } from "./commit";
import { gainsToExchange } from "./dungeon";
import { paths } from "./paths";

/**
 * 반복 레이드 한 판의 저장 (8단계 ⑤). 레이드 분야 피로 +1. 이기면 그 주 처음은 주간 보상(보상 출처 ID로 한 번만),
 * 그다음은 피로를 적용한 일반 보상을 「주고받기」로. 기여 점수는 그 주 내 최고 기록보다 높을 때만 바꿔 쓴다(더하지 않음).
 * 전투 결과·기여는 화면을 믿는다(던전과 같다). 같은 요청 ID는 한 번만.
 */

export const RAID_FATIGUE = "raid";

export const raidRewardId = (weekKey: string) => `raid-${weekKey}`;

export type RaidCommitResult =
  | {
      status: "ok";
      weekly: boolean;
      gains: ReturnType<typeof raidGains>;
      mailed: string[];
      record: boolean;
      score: number;
    }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitRaid(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: {
    weekKey: string;
    bossId: string;
    won: boolean;
    contribution: Contribution;
  },
  raids: RaidDefs,
  ctx: ExchangeContext,
): Promise<RaidCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const week = raidWeek(ctx.now, raids, ctx.limits);
  if (input.weekKey !== week.key || input.bossId !== week.boss.id)
    return {
      status: "rejected",
      detail: "보스가 교대되었다 (지난 주의 판은 기록하지 않는다)",
    };
  const c = input.contribution;
  const w = raids.contribution;
  const parts = [c.damage, c.stagger, c.prevented, c.reactions];
  if (
    parts.some((n) => !Number.isFinite(n) || n < 0) ||
    !Number.isInteger(c.reactions) ||
    c.score !==
      Math.round(
        c.damage +
          c.stagger * w.stagger +
          c.prevented * w.prevented +
          c.reactions * w.reaction,
      )
  )
    return { status: "rejected", detail: "기여 점수가 맞지 않다" };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };

  const shape = characterSchema(ctx.limits).shape;
  const names = [
    "meta/rev",
    "month",
    "profile/name",
    "wallet",
    "bag",
    "claimedRewards",
    "mailbox",
    "life",
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
      name: shape.profile.shape.name,
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
      life: shape.life,
    })
    .safeParse({
      rev: value("meta/rev"),
      month: value("month"),
      name: value("profile/name"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
      life: value("life"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`,
    );
  const before = read.data;
  const rawRecord = await db.get(paths.raidRecord(week.key, characterId));
  const best: RaidRecord | undefined =
    rawRecord == null ? undefined : RaidRecordSchema.parse(rawRecord);

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  const fatigueIndex = (before.month.fatigue[RAID_FATIGUE] ?? 0) + 1;
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(`month/fatigue/${RAID_FATIGUE}`, fatigueIndex);

  const record = best === undefined || c.score > best.score;
  if (record)
    updates[paths.raidRecord(week.key, characterId)] = RaidRecordSchema.parse({
      name: before.name,
      bossId: week.boss.id,
      score: c.score,
      damage: c.damage,
      stagger: c.stagger,
      prevented: c.prevented,
      reactions: c.reactions,
      at: ctx.now,
    });

  let weekly = false;
  let gains: ReturnType<typeof raidGains> = [];
  let mailed: string[] = [];
  if (input.won) {
    const rewardId = raidRewardId(week.key);
    weekly = before.claimedRewards[idToKey(rewardId)] !== true;
    gains = raidGains(
      week.boss,
      weekly,
      fatigueMultiplier(fatigueIndex, ctx.limits),
    );
    const { walletDelta, items } = gainsToExchange(gains, requestId);
    const exchange = applyExchange(
      {
        wallet: before.wallet,
        bag: before.bag,
        claimedRewards: before.claimedRewards,
        mailbox: before.mailbox,
      },
      {
        requestId,
        reason: `반복 레이드 ${week.boss.name}`,
        ...(weekly ? { rewardId } : {}),
        walletDelta,
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
    if (exchange.next.wallet !== before.wallet)
      set("wallet", exchange.next.wallet);
    diff(before.bag.stacks, exchange.next.bag.stacks, (key, v) =>
      set(`bag/stacks/${key}`, v),
    );
    diff(before.bag.uniques, exchange.next.bag.uniques, (key, v) =>
      set(`bag/uniques/${key}`, v),
    );
    diff(before.claimedRewards, exchange.next.claimedRewards, (key, v) =>
      set(`claimedRewards/${key}`, v),
    );
    diff(before.mailbox, exchange.next.mailbox, (key, v) =>
      set(`mailbox/${key}`, v),
    );
    updates[paths.ledger(characterId, requestId)] = LedgerLineSchema.parse(
      exchange.ledger,
    );
    if (weekly) {
      const line = shape.life.parse([
        {
          kind: "전투",
          ...(before.month.key ? { when: before.month.key } : {}),
          text: `반복 레이드 — ${week.boss.name} 토벌`,
        },
      ])[0];
      set(`life/${before.life.length}`, line);
    }
  }
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({
    at: ctx.now,
    kind: "레이드",
  });

  const written = await db.update(updates);
  if (written === "ok")
    return { status: "ok", weekly, gains, mailed, record, score: c.score };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
