import type { Character } from "../../schema/character";
import type { OldBattle, OldBundle, OldStorySession } from "./read-old";

type LifeLine = Character["life"][number];

const MAX_TEXT = 300;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
const outcome = (result: string | null | undefined, win: string, lose: string): string | undefined =>
  result === "win" ? win : result === "lose" ? lose : undefined;

/** 옛 달 번호(1부터)를 새 달 순번(0부터)으로 */
export function monthKeyOf(year: number, oldMonth: number): string {
  return `${year}-${Math.min(11, Math.max(0, oldMonth - 1))}`;
}

/**
 * 지난 삶 요약: 월간 기록, 이야기(의뢰), 전투에서 한 줄씩 만든다.
 * 전체 기록은 옮기지 않는다. 이 줄들이 나중에 「이방인들의 서가」의 책 재료가 된다.
 */
export function buildLife(bundle: OldBundle, battles: readonly OldBattle[], stories: readonly OldStorySession[]): LifeLine[] {
  const life: LifeLine[] = [];

  for (const month of bundle.months) {
    const parts = month.actions
      .filter((a) => a.name !== "")
      .map((a) => `${a.name}${a.detail ? `(${a.detail})` : ""}${a.result ? ` ${a.result}` : ""}`);
    if (parts.length > 0) life.push({ kind: "달", when: monthKeyOf(month.year, month.month), text: clip(parts.join(", ")) });
  }

  // 이야기에 딸린 전투는 이야기 한 줄로 충분하다
  const storyBattles = new Set<string>();
  for (const story of stories) {
    if (story.battleId) storyBattles.add(story.battleId);
    if (!(story.members ?? []).includes(bundle.player)) continue;
    const ended = outcome(story.result, "성공", "실패") ?? (story.phase === "done" ? "마침" : undefined);
    if (ended === undefined) continue;
    life.push({ kind: "이야기", text: clip(`「${story.title ?? "이름 없는 이야기"}」${story.region ? ` (${story.region})` : ""} — ${ended}`) });
  }

  for (const battle of battles) {
    if (storyBattles.has(battle.id) || battle.phase !== "over") continue;
    if (!(battle.members ?? []).includes(bundle.player)) continue;
    const ended = outcome(battle.result, "승리", "패배");
    if (ended === undefined) continue;
    life.push({ kind: "전투", text: clip(`「${battle.title ?? "이름 없는 전투"}」${battle.region ? ` (${battle.region})` : ""} — ${ended}`) });
  }
  return life;
}
