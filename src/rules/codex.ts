import type { Character } from "../schema/character";
import type { Enemy } from "../schema/defs/battle";
import type { Dungeon } from "../schema/defs/dungeon";
import type { HuntingDefs } from "../schema/defs/hunting";
import type { Limits } from "../schema/defs/limits";
import type { RaidDefs } from "../schema/defs/raid";
import { idToKey } from "../schema/keys";

/**
 * 도감 (명세서 「도감과 칭호」). 모두 순수 함수.
 * 적: 만나면 「처음 봄」(0단계), 이긴 수가 기준을 넘을 때마다 1·2·3단계. 빠른 공개 재능이 있으면 한 단계씩 빨리(겹치지 않음).
 * 물건: 처음 얻은 때만 적는다.
 */

/** 0: 처음 봄(이름·모습, 기술 이름만) · 1: 위력·저항 · 2: 성향·약점·드롭 · 3: 서식지·설명문·완성 */
export type CodexStage = 0 | 1 | 2 | 3;

export const inCodex = (enemy: Pick<Enemy, "codex">) =>
  enemy.codex?.hidden !== true;

/** 이 캐릭터가 적 도감을 한 단계 빨리 여는가 */
export function fastReveal(
  character: Pick<Character, "talents">,
  limits: Pick<Limits, "codex">,
): boolean {
  const { chosen, innate, acquired } = character.talents;
  return limits.codex.fastTalents.some(
    (t) => chosen.includes(t) || innate === t || acquired[idToKey(t)] === true,
  );
}

/** 이긴 수 → 단계. 만난 적 없으면 undefined */
export function codexStage(
  wins: number | undefined,
  fast: boolean,
  limits: Pick<Limits, "codex">,
): CodexStage | undefined {
  if (wins === undefined) return undefined;
  const [a, b, c] = limits.codex.stages;
  const needs = fast ? [0, a, b] : [a, b, c];
  let stage: CodexStage = 0;
  needs.forEach((n, i) => {
    if (wins >= n) stage = (i + 1) as CodexStage;
  });
  return stage;
}

/** 한 판에서 만난 적과 이긴 수: 이기면 그 적 하나하나를 센다, 지면 만남만 */
export function battleTally(
  enemyDefIds: readonly string[],
  won: boolean,
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const id of enemyDefIds) tally[id] = (tally[id] ?? 0) + (won ? 1 : 0);
  return tally;
}

/** 두 집계를 더한다 (던전처럼 여러 판을 모아 둘 때) */
export function mergeTally(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [id, n] of Object.entries(b)) out[id] = (out[id] ?? 0) + n;
  return out;
}

export interface CodexEnemyChange {
  /** 저장 키 → 새 이긴 수 */
  set: Record<string, number>;
  /** 이번에 3단계가 열린 적 (완성 보상) */
  completed: Enemy[];
}

/** 이전 도감 + 이번 집계 → 바뀔 칸과 새로 완성된 적. 도감에 없는 적(허수아비 등)은 빼고, 모르는 적 ID는 무시한다 */
export function codexEnemyChange(
  before: Readonly<Record<string, number>>,
  tally: Readonly<Record<string, number>>,
  enemies: ReadonlyMap<string, Enemy>,
  fast: boolean,
  limits: Pick<Limits, "codex">,
): CodexEnemyChange {
  const set: Record<string, number> = {};
  const completed: Enemy[] = [];
  for (const [id, wins] of Object.entries(tally)) {
    const enemy = enemies.get(id);
    if (!enemy || !inCodex(enemy)) continue;
    const key = idToKey(id);
    const old = before[key];
    const next = (old ?? 0) + wins;
    if (old === undefined || next !== old) set[key] = next;
    if (
      codexStage(old, fast, limits) !== 3 &&
      codexStage(next, fast, limits) === 3
    )
      completed.push(enemy);
  }
  return { set, completed };
}

/** 완성 보상의 보상 출처 ID (한 번만) */
export const codexRewardId = (enemyId: string) => `codex-${enemyId}`;

/** 처음 얻은 물건만 (저장 키 → 시각) */
export function firstItems(
  before: Readonly<Record<string, number>>,
  itemIds: readonly string[],
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of itemIds) {
    const key = idToKey(id);
    if (before[key] === undefined && out[key] === undefined) out[key] = now;
  }
  return out;
}

/**
 * 2단계에 보이는 드롭: 그 적이 나오는 곳의 정의(던전 전리품표·사냥 얻는 것·레이드 보상)에서 모은 물건 ID.
 * 정예·보스 방의 전리품과 레이드 보상은 그 등급의 적에게만 붙인다(같이 나오는 졸개에게는 붙이지 않는다).
 */
export function dropsOf(
  enemy: Pick<Enemy, "id" | "rank">,
  defs: { dungeons: readonly Dungeon[]; hunting: HuntingDefs; raids: RaidDefs },
): string[] {
  const has = (members: readonly { enemy: string }[]) =>
    members.some((m) => m.enemy === enemy.id);
  const out = new Set<string>();
  for (const d of defs.dungeons) {
    const tables = { 일반: d.loot.전투, 정예: d.loot.정예, 보스: d.loot.보스 };
    if (d.groups[enemy.rank].some((g) => has(g.enemies)))
      for (const e of tables[enemy.rank].entries)
        if (e.kind === "물건") out.add(e.item);
  }
  for (const ground of defs.hunting.grounds)
    for (const prey of ground.prey)
      if (prey.danger && has(prey.danger.enemies))
        for (const d of prey.drops) out.add(d.item);
  if (enemy.rank === "보스")
    for (const boss of defs.raids.bosses)
      if (has(boss.enemies))
        for (const r of boss.repeat) if (r.kind === "물건") out.add(r.item);
  return [...out];
}

/** 전투 화면: 도감 1단계(위력·저항) 전인 적은 위력을 가린다. 도감에 없는 적(허수아비·그림자)은 가리지 않는다 */
export function hidePowerFor(
  character: Pick<Character, "codex" | "talents">,
  enemies: readonly Enemy[],
  limits: Pick<Limits, "codex">,
): (defId: string) => boolean {
  const byId = new Map(enemies.map((e) => [e.id, e]));
  const fast = fastReveal(character, limits);
  return (defId) => {
    const enemy = byId.get(defId);
    if (!enemy || !inCodex(enemy)) return false;
    return (
      (codexStage(character.codex.enemies[idToKey(defId)], fast, limits) ?? 0) <
      1
    );
  };
}
