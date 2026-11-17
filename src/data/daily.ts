import { advanceMonth, dateKeyAt, initialClock, missingDays, monthKeyOf, rolloverMonth, yearEndAge } from "../rules/world-clock";
import { characterSchema } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import { DailyRunSchema, WORLD_CLOCK_PATH, WorldClockSchema, type DailyStep, type WorldClock } from "../schema/world";
import type { AdminPort } from "./migrate-write";

/**
 * 하루 계산 (명세서 「하루 계산」·「세계 시계와 달 행동」). GitHub Actions의 예약 실행이 관리자 키로 돌린다.
 *
 * 순서: 계산 중 켜기 → 빠진 날마다 [백업 → 달 넘어감 → 마무리] → 계산 중 끄기 → 실행 기록.
 * 날마다 단계를 끝낼 때 진행(`progress`)을 같은 쓰기에 남긴다. 도중에 실패하면 다음 실행이 끝난 단계를 건너뛰고 이어서 한다.
 * 「달 넘어감」은 세계의 달과 모든 캐릭터를 한 번의 쓰기로 바꾼다(다 되거나 하나도 안 된다).
 * 생활비·신선도·시장·레이드·월보·칭호·검증·정리는 그 시스템이 생길 때 단계로 더한다.
 */

export interface DailyOptions {
  limits: Limits;
  now: number;
  /** 전체 데이터를 공개되지 않는 곳에 둔다. 둔 곳을 돌려준다. 없으면 백업은 건너뛴다고 적는다 */
  backup?: (dateKey: string, data: unknown) => Promise<string>;
}

export interface DailyReport {
  days: string[];
  notes: string[];
}

export class DailyError extends Error {
  override name = "DailyError";
}

export async function runDaily(db: AdminPort, options: DailyOptions): Promise<DailyReport> {
  const startedAt = options.now;
  const notes: string[] = [];
  const done: string[] = [];
  const runKey = `run-${startedAt}`;

  const raw = await db.get(WORLD_CLOCK_PATH);
  if (raw === null || raw === undefined) {
    const clock = initialClock(options.limits, options.now);
    await db.update({ [WORLD_CLOCK_PATH]: clock });
    notes.push(`처음 세계 시계를 만들었다: ${clock.monthKey}, ${clock.lastDateKey}까지 처리한 것으로`);
    await writeRun(db, runKey, { startedAt, finishedAt: options.now, ok: true, days: [], notes });
    return { days: [], notes };
  }
  const parsed = WorldClockSchema.safeParse(raw);
  if (!parsed.success) throw new DailyError(`세계 시계가 스키마와 다르다: ${parsed.error.issues[0]?.message ?? ""}`);
  let clock: WorldClock = parsed.data;

  const today = dateKeyAt(options.now, options.limits.clock.utcOffsetHours);
  const days = missingDays(clock.lastDateKey, today);
  if (days.length === 0) {
    if (clock.computing) await db.update({ [`${WORLD_CLOCK_PATH}/computing`]: false });
    notes.push("오늘까지 이미 처리했다");
    await writeRun(db, runKey, { startedAt, finishedAt: options.now, ok: true, days: [], notes });
    return { days: [], notes };
  }

  try {
    // 계산 중 켜기: 이 동안 달 행동 요청을 받지 않는다
    if (!clock.computing) await db.update({ [`${WORLD_CLOCK_PATH}/computing`]: true });
    clock = { ...clock, computing: true };

    for (const [index, dateKey] of days.entries()) {
      const finished = new Set<DailyStep>(clock.progress?.dateKey === dateKey ? clock.progress.done : []);
      const mark = (step: DailyStep) => {
        finished.add(step);
        return { [`${WORLD_CLOCK_PATH}/progress`]: { dateKey, done: [...finished] } };
      };

      if (!finished.has("백업")) {
        if (index > 0) notes.push(`${dateKey}: 백업은 이번 실행의 첫날에 했다`);
        else if (options.backup) notes.push(`${dateKey}: 백업 ${await options.backup(dateKey, await db.get(""))}`);
        else notes.push(`${dateKey}: 백업할 곳이 없어 건너뜀`);
        await db.update(mark("백업"));
      }

      if (!finished.has("달 넘어감")) {
        const next = advanceMonth(clock);
        const updates: Record<string, unknown> = {
          [`${WORLD_CLOCK_PATH}/year`]: next.year,
          [`${WORLD_CLOCK_PATH}/monthIndex`]: next.monthIndex,
          [`${WORLD_CLOCK_PATH}/monthKey`]: monthKeyOf(next),
          ...mark("달 넘어감"),
        };
        const counts = await rolloverCharacters(db, options.limits, monthKeyOf(next), next.yearEnd, updates);
        await db.update(updates);
        clock = { ...clock, year: next.year, monthIndex: next.monthIndex, monthKey: monthKeyOf(next) };
        notes.push(
          `${dateKey}: ${monthKeyOf(next)}${next.yearEnd ? " (한 해 정리)" : ""} — 캐릭터 ${counts.rolled}명 넘어감` +
            (counts.skipped.length > 0 ? `, 읽지 못해 건너뜀: ${counts.skipped.join(", ")}` : ""),
        );
      }

      // 마무리: 날짜를 기록하고 진행을 지운다
      await db.update({ [`${WORLD_CLOCK_PATH}/lastDateKey`]: dateKey, [`${WORLD_CLOCK_PATH}/progress`]: null });
      clock = { ...clock, lastDateKey: dateKey };
      delete clock.progress;
      done.push(dateKey);
    }

    await db.update({ [`${WORLD_CLOCK_PATH}/computing`]: false });
    await writeRun(db, runKey, { startedAt, finishedAt: options.now, ok: true, days: done, notes });
    return { days: done, notes };
  } catch (error) {
    // 계산 중 표시는 켠 채로 둔다: 다음 실행이 끝난 단계를 건너뛰고 이어서 한다
    const message = error instanceof Error ? error.message : String(error);
    await writeRun(db, runKey, { startedAt, finishedAt: options.now, ok: false, days: done, notes, error: message.slice(0, 2000) }).catch(() => undefined);
    throw error;
  }
}

/** 모든 캐릭터의 달 넘어감(과 한 해 정리)을 updates에 더한다. 이미 그 달인 캐릭터는 그대로 */
async function rolloverCharacters(
  db: AdminPort,
  limits: Limits,
  newKey: string,
  yearEnd: boolean,
  updates: Record<string, unknown>,
): Promise<{ rolled: number; skipped: string[] }> {
  const schema = characterSchema(limits);
  const all = ((await db.get("characters")) ?? {}) as Record<string, unknown>;
  let rolled = 0;
  const skipped: string[] = [];
  for (const [id, raw] of Object.entries(all)) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      skipped.push(id);
      continue;
    }
    const character = parsed.data;
    const result = rolloverMonth(character.month, newKey, limits, character.profile.job?.workplace !== undefined);
    if (!result.changed) continue;
    rolled++;
    const base = `characters/${id}`;
    updates[`${base}/month`] = result.month;
    let life = character.life.length;
    if (result.auto.work + result.auto.rest > 0) {
      const parts = [result.auto.work > 0 ? `일하기 ${result.auto.work}번` : "", result.auto.rest > 0 ? `쉬기 ${result.auto.rest}번` : ""].filter(Boolean);
      updates[`${base}/life/${life++}`] = { kind: "달", when: character.month.key, text: `저장 행동이 넘쳐 자동 처리: ${parts.join(", ")}` };
    }
    if (yearEnd) updates[`${base}/profile/age`] = yearEndAge(character.profile.age);
  }
  return { rolled, skipped };
}

async function writeRun(db: AdminPort, runKey: string, run: unknown): Promise<void> {
  await db.update({ [`world/runs/${runKey}`]: DailyRunSchema.parse(run) });
}
