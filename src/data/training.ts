import { z } from "zod";
import { battleTally } from "../rules/codex";
import type { ExchangeContext } from "../rules/exchange";
import { isBlocked } from "../rules/training";
import { characterSchema } from "../schema/character";
import type { TrainingDefs } from "../schema/defs/training";
import { KEY_PATTERN, idToKey } from "../schema/keys";
import { RequestRecordSchema } from "../schema/ledger";
import { CommitError, type DbPort } from "./commit";
import { codexMoneyWrites, planEnemyCodex } from "./codex";
import { paths } from "./paths";

/**
 * 교관 대련(벽 시험) 한 번의 저장 (8단계 ④ 훈련장). 훈련장 분야 피로 +1, 이기면 그 벽의 통과 표시와 일생 한 줄을
 * 수정 번호·요청 기록과 한 번에. 지면 피로만 오르고 언제든 다시 할 수 있다. 같은 요청 ID는 한 번만.
 * 정말 그 벽에 막혀 있을 때만 받는다. 전투 결과는 화면을 믿는다(던전과 같다). 허수아비는 저장하지 않는다.
 */

export const TRAINING_FATIGUE = "training";

export type WallTestResult =
  | { status: "ok"; passed: boolean }
  | { status: "duplicate" }
  | { status: "rejected"; detail: string }
  | { status: "conflict" };

export async function commitWallTest(
  db: DbPort,
  characterId: string,
  requestId: string,
  input: {
    groundId: string;
    skill: string;
    skillName: string;
    wall: 60 | 80;
    won: boolean;
  },
  training: TrainingDefs,
  ctx: ExchangeContext,
): Promise<WallTestResult> {
  if (!KEY_PATTERN.test(characterId) || !KEY_PATTERN.test(requestId))
    return { status: "rejected", detail: "캐릭터·요청 ID의 모양이 틀리다" };
  const ground = training.grounds.find((g) => g.id === input.groundId);
  if (!ground)
    return { status: "rejected", detail: `없는 훈련장: ${input.groundId}` };
  const wall = ground.walls.find((w) => w.at === input.wall);
  if (!wall)
    return {
      status: "rejected",
      detail: `이 훈련장에는 ${input.wall} 벽 시험이 없다`,
    };
  if ((await db.get(paths.request(characterId, requestId))) != null)
    return { status: "duplicate" };

  const shape = characterSchema(ctx.limits).shape;
  const names = ["meta/rev", "month", "mastery", "life"] as const;
  const raw = await Promise.all(
    names.map((name) => db.get(paths.characterPart(characterId, name))),
  );
  const value = (name: (typeof names)[number]) =>
    raw[names.indexOf(name)] ?? undefined;
  const read = z
    .strictObject({
      rev: shape.meta.shape.rev,
      month: shape.month,
      mastery: shape.mastery,
      life: shape.life,
    })
    .safeParse({
      rev: value("meta/rev"),
      month: value("month"),
      mastery: value("mastery"),
      life: value("life"),
    });
  if (!read.success)
    throw new CommitError(
      `캐릭터 ${characterId}의 값이 스키마와 다르다: ${read.error.issues[0]?.path.join(".") ?? ""} ${read.error.issues[0]?.message ?? ""}`,
    );
  const before = read.data;
  if (!isBlocked(before, input.skill, input.wall))
    return {
      status: "rejected",
      detail: `${input.skillName} ${input.wall} 벽에 막혀 있지 않다`,
    };

  const updates: Record<string, unknown> = {};
  const set = (name: string, v: unknown) => {
    updates[paths.characterPart(characterId, name)] = v;
  };
  set("meta/rev", before.rev + 1);
  set("meta/lastRequestId", requestId);
  set(
    `month/fatigue/${TRAINING_FATIGUE}`,
    (before.month.fatigue[TRAINING_FATIGUE] ?? 0) + 1,
  );
  if (input.won) {
    set(`mastery/${idToKey(input.skill)}/passed${input.wall}`, true);
    const line = shape.life.parse([
      {
        kind: "전투",
        ...(before.month.key ? { when: before.month.key } : {}),
        text: `${input.skillName} ${input.wall} 벽을 넘었다 — ${wall.lifeNote}`,
      },
    ])[0];
    set(`life/${before.life.length}`, line);
  }
  // 교관도 적 도감에 (만남·이긴 수). 3단계가 열리면 완성 보상 잎전
  const codex = await planEnemyCodex(
    db,
    characterId,
    battleTally(
      wall.enemies.map((m) => m.enemy),
      input.won,
    ),
    ctx.limits,
  );
  Object.assign(updates, codex.writes);
  const money = await codexMoneyWrites(db, characterId, requestId, codex.money, `도감 완성 ${codex.completed.map((e) => e.name).join(", ")}`, ctx);
  if (!money.ok) return { status: "rejected", detail: money.detail };
  Object.assign(updates, money.writes);
  updates[paths.request(characterId, requestId)] = RequestRecordSchema.parse({
    at: ctx.now,
    kind: "훈련",
  });

  const written = await db.update(updates);
  if (written === "ok") return { status: "ok", passed: input.won };
  return (await db.get(paths.request(characterId, requestId))) != null
    ? { status: "duplicate" }
    : { status: "conflict" };
}
