import { z } from "zod";
import { applyExchange, type ExchangeContext } from "../rules/exchange";
import { applySceneResults } from "../rules/scene/apply";
import type { Result } from "../rules/scene/parse";
import { characterSchema } from "../schema/character";
import { KEY_PATTERN } from "../schema/keys";
import { LedgerLineSchema, RequestRecordSchema } from "../schema/ledger";
import { CommitError, diff, type DbPort } from "./commit";
import { paths } from "./paths";

export type SceneCommitResult =
  /** 적용했다. summary는 화면에 보일 요약 */
  | { status: "ok"; summary: string[] }
  /** 이미 본 장면: 결과는 다시 적용되지 않는다 */
  | { status: "seen" }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

/**
 * 장면이 끝날 때 결과를 한 번에 저장한다 (명세서 「장면」).
 * 본 장면 기록·표시·단서·친밀도·인물·퀘스트 기록·능력치·보류 결과, 그리고 잎전·물건(「주고받기」, 보상 출처 = 장면)을
 * 수정 번호·요청 기록과 함께 한 번의 쓰기로. 이미 본 장면이면 아무것도 바꾸지 않는다. 같은 요청 ID는 한 번만.
 */
export async function commitScene(
  db: DbPort,
  characterId: string,
  requestId: string,
  scene: { id: string; results: readonly Result[]; choices: readonly string[] },
  ctx: Omit<ExchangeContext, "now"> & { now: number; resolve: (text: string) => string },
): Promise<SceneCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId) || !KEY_PATTERN.test(scene.id)) {
    return { status: "rejected", detail: "캐릭터·요청·장면 ID의 모양이 틀리다" };
  }
  if ((await db.get(paths.request(characterId, requestId))) != null) return { status: "duplicate" };
  if ((await db.get(paths.characterPart(characterId, `scenes/${scene.id}`))) != null) return { status: "seen" };

  const shape = characterSchema(ctx.limits).shape;
  const names = ["meta/rev", "profile/marks", "people", "abilities", "clues", "quests", "pendingResults", "wallet", "bag", "claimedRewards", "mailbox"] as const;
  const raw = await Promise.all(names.map((name) => db.get(paths.characterPart(characterId, name))));
  const value = (name: (typeof names)[number]) => raw[names.indexOf(name)] ?? undefined;
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      marks: shape.profile.shape.marks,
      people: shape.people,
      abilities: shape.abilities,
      clues: shape.clues,
      quests: shape.quests,
      pending: shape.pendingResults,
      wallet: shape.wallet,
      bag: shape.bag,
      claimedRewards: shape.claimedRewards,
      mailbox: shape.mailbox,
    })
    .safeParse({
      rev: value("meta/rev"),
      marks: value("profile/marks"),
      people: value("people"),
      abilities: value("abilities"),
      clues: value("clues"),
      quests: value("quests"),
      pending: value("pendingResults"),
      wallet: value("wallet"),
      bag: value("bag"),
      claimedRewards: value("claimedRewards"),
      mailbox: value("mailbox"),
    });
  if (!read.success) throw new CommitError(`캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`);
  const before = read.data;

  const out = applySceneResults({ sceneId: scene.id, results: scene.results, ...before, limits: ctx.limits, items: ctx.items, resolve: ctx.resolve });

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(`scenes/${scene.id}`, shape.scenes.parse({ [scene.id]: { at: ctx.now, choices: [...scene.choices] } })[scene.id]);
  if (JSON.stringify(out.marks) !== JSON.stringify(before.marks)) set("profile/marks", out.marks);
  if (JSON.stringify(out.clues) !== JSON.stringify(before.clues)) set("clues", out.clues);
  if (JSON.stringify(out.quests) !== JSON.stringify(before.quests)) set("quests", shape.quests.parse(out.quests));
  if (JSON.stringify(out.pending) !== JSON.stringify(before.pending)) set("pendingResults", shape.pendingResults.parse(out.pending));
  if (JSON.stringify(out.abilities) !== JSON.stringify(before.abilities)) set("abilities", shape.abilities.parse(out.abilities));
  diff(before.people, shape.people.parse(out.people), (key, v) => set(`people/${key}`, v));

  // 잎전·물건은 「주고받기」로: 보상 출처는 장면 (같은 장면의 보상은 한 번만)
  if (out.walletDelta !== 0 || out.gains.length > 0) {
    const exchange = applyExchange(
      { wallet: before.wallet, bag: before.bag, claimedRewards: before.claimedRewards, mailbox: before.mailbox },
      { requestId, reason: `장면 ${scene.id}`, rewardId: `scene_${scene.id}`, walletDelta: out.walletDelta, gains: out.gains, losses: [], overflow: "우편함" },
      { ...ctx, now: ctx.now },
    );
    if (!exchange.ok) return { status: "rejected", detail: `${exchange.reason}: ${exchange.detail}` };
    if (exchange.next.wallet !== before.wallet) set("wallet", exchange.next.wallet);
    diff(before.bag.stacks, exchange.next.bag.stacks, (key, v) => set(`bag/stacks/${key}`, v));
    diff(before.bag.uniques, exchange.next.bag.uniques, (key, v) => set(`bag/uniques/${key}`, v));
    diff(before.claimedRewards, exchange.next.claimedRewards, (key, v) => set(`claimedRewards/${key}`, v));
    diff(before.mailbox, exchange.next.mailbox, (key, v) => set(`mailbox/${key}`, v));
    updates[paths.ledger(characterId, requestId)] = LedgerLineSchema.parse(exchange.ledger);
  }
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({ at: ctx.now, kind: "장면" });

  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", summary: out.summary };
  if ((await db.get(paths.request(characterId, requestId))) != null) return { status: "duplicate" };
  return { status: "conflict" };
}
