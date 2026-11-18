import { z } from "zod";
import { scoreChange, seasonKey, snapshotBuild } from "../rules/arena";
import type { AllyDefs } from "../rules/battle/ally-of";
import { fatigueMultiplier } from "../rules/dungeon/end";
import {
  ArenaEntrySchema,
  ArenaLogLineSchema,
  type ArenaEntry,
} from "../schema/arena";
import { characterSchema } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import { KEY_PATTERN } from "../schema/keys";
import { RequestRecordSchema } from "../schema/ledger";
import { CommitError, type DbPort } from "./commit";
import { TRAINING_FATIGUE } from "./training";
import { paths } from "./paths";

/**
 * 투기장 저장 (8단계 ④ 나). 순위표 칸은 /arena/{계절}/entries/{cid}, 나에게 온 도전은 /arena/{계절}/log/{cid}.
 * 등록: 지금 빌드를 찍어 둔다(점수·승패는 그대로, 처음이면 시작 점수). 결투: 훈련장 분야 피로 +1,
 * 도전한 사람의 점수·승패만 바뀌고 상대 기록에 한 줄. 전투 결과는 화면을 믿는다(던전과 같다). 같은 요청 ID는 한 번만.
 */

export type ArenaCommitResult =
  | { status: "ok"; season: string; entry: ArenaEntry; delta?: number }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

type Ctx = { limits: Limits; now: number };

async function readParts<const N extends readonly string[]>(
  db: DbPort,
  characterId: string,
  names: N,
) {
  const raw = await Promise.all(
    names.map((name) => db.get(paths.characterPart(characterId, name))),
  );
  return (name: N[number]) => raw[names.indexOf(name)] ?? undefined;
}

const schemaError = (characterId: string, error: z.ZodError) =>
  new CommitError(
    `캐릭터 ${characterId}의 값이 스키마와 다르다: ${error.issues[0]?.path.join(".") ?? ""} ${error.issues[0]?.message ?? ""}`,
  );

async function readEntry(
  db: DbPort,
  season: string,
  characterId: string,
): Promise<ArenaEntry | undefined> {
  const raw = await db.get(paths.arenaEntry(season, characterId));
  if (raw == null) return undefined;
  const parsed = ArenaEntrySchema.safeParse(raw);
  if (!parsed.success)
    throw new CommitError(
      `투기장 칸 ${characterId}의 값이 스키마와 다르다: ${parsed.error.issues[0]?.path.join(".") ?? ""}`,
    );
  return parsed.data;
}

async function finish(
  db: DbPort,
  characterId: string,
  requestId: string,
  updates: Record<string, unknown>,
  ok: Extract<ArenaCommitResult, { status: "ok" }>,
): Promise<ArenaCommitResult> {
  const written = await db.update(updates);
  if (written === "ok") return ok;
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}

/** 지금 빌드를 이번 계절 투기장에 등록(다시 등록하면 빌드만 바뀐다) */
export async function registerBuild(
  db: DbPort,
  characterId: string,
  requestId: string,
  trees: AllyDefs["trees"],
  ctx: Ctx,
): Promise<ArenaCommitResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };
  const shape = characterSchema(ctx.limits).shape;
  const value = await readParts(db, characterId, [
    "meta/rev",
    "month/key",
    "profile/name",
    "abilities",
    "trees",
    "loadout",
    "mastery",
  ] as const);
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      monthKey: shape.month.shape.key,
      name: shape.profile.shape.name,
      abilities: shape.abilities,
      trees: shape.trees,
      loadout: shape.loadout,
      mastery: shape.mastery,
    })
    .safeParse({
      rev: value("meta/rev"),
      monthKey: value("month/key"),
      name: value("profile/name"),
      abilities: value("abilities"),
      trees: value("trees"),
      loadout: value("loadout"),
      mastery: value("mastery"),
    });
  if (!read.success) throw schemaError(characterId, read.error);
  const c = read.data;
  const season = seasonKey(c.monthKey);
  const build = snapshotBuild(
    {
      profile: { name: c.name },
      abilities: c.abilities,
      trees: c.trees,
      loadout: c.loadout,
      mastery: c.mastery,
    },
    trees,
  );
  const before = await readEntry(db, season, characterId);
  const entry = ArenaEntrySchema.parse(
    before
      ? { ...before, build, registeredAt: ctx.now }
      : {
          build,
          registeredAt: ctx.now,
          score: ctx.limits.arena.startScore,
          wins: 0,
          losses: 0,
        },
  );
  const updates: Record<string, unknown> = {
    [paths.characterPart(characterId, "meta/rev")]: c.rev + 1,
    [paths.characterPart(characterId, "meta/lastRequestId")]: requestId,
    [paths.arenaEntry(season, characterId)]: entry,
    [paths.request(characterId, requestId)]: RequestRecordSchema.parse({
      at: ctx.now,
      kind: "투기장 등록",
    }),
  };
  return finish(db, characterId, requestId, updates, {
    status: "ok",
    season,
    entry,
  });
}

/** 결투 한 번의 결과 */
export async function commitDuel(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: { opponent: string; won: boolean },
  ctx: Ctx,
): Promise<ArenaCommitResult> {
  if (
    !KEY_PATTERN.test(characterId) ||
    !KEY_PATTERN.test(requestId) ||
    !KEY_PATTERN.test(input.opponent)
  )
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  if (input.opponent === characterId)
    return { status: "rejected", detail: "자기 자신과는 결투할 수 없다" };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };
  const shape = characterSchema(ctx.limits).shape;
  const value = await readParts(db, characterId, [
    "meta/rev",
    "month",
    "profile/name",
  ] as const);
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      month: shape.month,
      name: shape.profile.shape.name,
    })
    .safeParse({
      rev: value("meta/rev"),
      month: value("month"),
      name: value("profile/name"),
    });
  if (!read.success) throw schemaError(characterId, read.error);
  const c = read.data;
  const season = seasonKey(c.month.key);
  const [mine, theirs] = await Promise.all([
    readEntry(db, season, characterId),
    readEntry(db, season, input.opponent),
  ]);
  if (!mine)
    return {
      status: "rejected",
      detail: "이번 계절 투기장에 빌드를 등록하지 않았다",
    };
  if (!theirs)
    return { status: "rejected", detail: "상대가 이번 계절 투기장에 없다" };

  const fatigueIndex = (c.month.fatigue[TRAINING_FATIGUE] ?? 0) + 1;
  const delta = scoreChange(
    mine.score,
    theirs.score,
    input.won,
    fatigueMultiplier(fatigueIndex, ctx.limits),
    ctx.limits,
  );
  const entry: ArenaEntry = {
    ...mine,
    score: mine.score + delta,
    wins: mine.wins + (input.won ? 1 : 0),
    losses: mine.losses + (input.won ? 0 : 1),
  };
  const at = (name: string) =>
    `${paths.arenaEntry(season, characterId)}/${name}`;
  const updates: Record<string, unknown> = {
    [paths.characterPart(characterId, "meta/rev")]: c.rev + 1,
    [paths.characterPart(characterId, "meta/lastRequestId")]: requestId,
    [paths.characterPart(characterId, `month/fatigue/${TRAINING_FATIGUE}`)]:
      fatigueIndex,
    [at("score")]: entry.score,
    [at("wins")]: entry.wins,
    [at("losses")]: entry.losses,
    [paths.arenaLog(season, input.opponent, requestId)]:
      ArenaLogLineSchema.parse({
        at: ctx.now,
        from: characterId,
        fromName: c.name,
        challengerWon: input.won,
      }),
    [paths.request(characterId, requestId)]: RequestRecordSchema.parse({
      at: ctx.now,
      kind: "결투",
    }),
  };
  return finish(db, characterId, requestId, updates, {
    status: "ok",
    season,
    entry,
    delta,
  });
}
