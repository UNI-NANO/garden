import { z } from "zod";
import rawEnemies from "../../data/defs/enemies.json";
import {
  codexEnemyChange,
  codexRewardId,
  fastReveal,
  firstItems,
} from "../rules/codex";
import { characterSchema } from "../schema/character";
import { EnemyListSchema, type Enemy } from "../schema/defs/battle";
import type { Limits } from "../schema/defs/limits";
import { idToKey } from "../schema/keys";
import {
  applyExchange,
  type ExchangeContext,
  type LedgerLine,
} from "../rules/exchange";
import { LedgerLineSchema } from "../schema/ledger";
import { CommitError, type DbPort } from "./commit";
import { paths } from "./paths";

/**
 * 도감 저장 도우미 (8단계 ⑥ 가). 저장 함수마다 같은 쓰기 안에 도감 칸을 함께 넣는다.
 * 도감 칸은 직접 읽는다: 같은 쓰기의 수정 번호 검사가 그사이 바뀐 것을 막는다.
 */

let enemyMap: ReadonlyMap<string, Enemy> | undefined;
/** 적 정의 (한 번만 읽고 스키마 검사) */
export function codexEnemies(): ReadonlyMap<string, Enemy> {
  enemyMap ??= new Map(
    EnemyListSchema.parse(rawEnemies).enemies.map((e) => [e.id, e]),
  );
  return enemyMap;
}

export interface EnemyCodexPlan {
  /** 경로 → 값 (도감 칸과 완성 보상의 받은 보상 표시) */
  writes: Record<string, unknown>;
  /** 완성 보상 잎전 합 (같은 쓰기의 「주고받기」에 더한다) */
  money: number;
  completed: Enemy[];
}

/** 한 판(또는 모은 여러 판)의 만남·이긴 수를 도감에 */
export async function planEnemyCodex(
  db: DbPort,
  characterId: string,
  tally: Readonly<Record<string, number>>,
  limits: Limits,
): Promise<EnemyCodexPlan> {
  if (Object.keys(tally).length === 0)
    return { writes: {}, money: 0, completed: [] };
  const shape = characterSchema(limits).shape;
  const [rawCodex, rawTalents, rawClaimed] = await Promise.all([
    db.get(paths.characterPart(characterId, "codex")),
    db.get(paths.characterPart(characterId, "talents")),
    db.get(paths.characterPart(characterId, "claimedRewards")),
  ]);
  const read = z
    .strictObject({
      codex: shape.codex,
      talents: shape.talents,
      claimed: shape.claimedRewards,
    })
    .safeParse({
      codex: rawCodex ?? undefined,
      talents: rawTalents ?? undefined,
      claimed: rawClaimed ?? undefined,
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 도감 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""}`,
    );
  const { codex, talents, claimed } = read.data;
  const change = codexEnemyChange(
    codex.enemies,
    tally,
    codexEnemies(),
    fastReveal({ talents }, limits),
    limits,
  );
  const writes: Record<string, unknown> = {};
  for (const [key, wins] of Object.entries(change.set))
    writes[paths.characterPart(characterId, `codex/enemies/${key}`)] = wins;
  let money = 0;
  for (const enemy of change.completed) {
    const key = idToKey(codexRewardId(enemy.id));
    if (claimed[key] === true) continue;
    writes[paths.characterPart(characterId, `claimedRewards/${key}`)] = true;
    money += enemy.codex?.completionMoney ?? 0;
  }
  return { writes, money, completed: change.completed };
}

/** 이번 쓰기의 「주고받기」 장부에서 처음 얻은 물건을 물건 도감에 (넘쳐 우편함으로 간 것도 얻은 것) */
export async function itemCodexWrites(
  db: DbPort,
  characterId: string,
  requestId: string,
  updates: Readonly<Record<string, unknown>>,
  now: number,
): Promise<Record<string, unknown>> {
  const ledger = updates[paths.ledger(characterId, requestId)] as
    | LedgerLine
    | undefined;
  const gained = (ledger?.items ?? [])
    .filter((i) => i.delta > 0)
    .map((i) => i.itemId);
  if (gained.length === 0) return {};
  const raw = await db.get(paths.characterPart(characterId, "codex/items"));
  const before = z.record(z.string(), z.number()).safeParse(raw ?? {});
  const firsts = firstItems(before.success ? before.data : {}, gained, now);
  const writes: Record<string, unknown> = {};
  for (const [key, at] of Object.entries(firsts))
    writes[paths.characterPart(characterId, `codex/items/${key}`)] = at;
  return writes;
}

/** 다른 「주고받기」가 없는 저장(교관 대련 등)에서 완성 보상 잎전만 넣는다. 지갑·장부를 같은 쓰기에 */
export async function codexMoneyWrites(
  db: DbPort,
  characterId: string,
  requestId: string,
  money: number,
  reason: string,
  ctx: ExchangeContext,
): Promise<
  { ok: true; writes: Record<string, unknown> } | { ok: false; detail: string }
> {
  if (money <= 0) return { ok: true, writes: {} };
  const shape = characterSchema(ctx.limits).shape;
  const [wallet, bag, claimed, mailbox] = await Promise.all(
    ["wallet", "bag", "claimedRewards", "mailbox"].map((n) =>
      db.get(paths.characterPart(characterId, n)),
    ),
  );
  const read = z
    .strictObject({
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
    })
    .safeParse({
      wallet: wallet ?? undefined,
      bag: bag ?? undefined,
      claimedRewards: claimed ?? undefined,
      mailbox: mailbox ?? undefined,
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""}`,
    );
  const exchange = applyExchange(
    read.data,
    {
      requestId,
      reason,
      walletDelta: money,
      gains: [],
      losses: [],
      overflow: "우편함",
    },
    ctx,
  );
  if (!exchange.ok)
    return { ok: false, detail: `${exchange.reason}: ${exchange.detail}` };
  return {
    ok: true,
    writes: {
      [paths.characterPart(characterId, "wallet")]: exchange.next.wallet,
      [paths.ledger(characterId, requestId)]: LedgerLineSchema.parse(
        exchange.ledger,
      ),
    },
  };
}
