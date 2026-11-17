import type { Limits } from "../schema/defs/limits";

/**
 * 구역 대화 (명세서 「퀘스트·장면·구역 대화」). 같은 구역(장소 하나, 위치가 없으면 도서관)에 있는 사람끼리만.
 * 이 파일은 순수 함수: 구역 키, 보낼 말 다듬기, 빨리 보내기 막기.
 */

/** 위치가 없는 캐릭터의 구역 */
export const LIBRARY_ZONE = "library";

/** 지역·장소 → 데이터베이스 키. 한글을 키로 쓸 수 없어 UTF-8을 16진수로 (`z` + 16진수, 96자 안) */
export function zoneKeyOf(location: { region: string; place: string } | undefined): string {
  if (!location) return LIBRARY_ZONE;
  const bytes = new TextEncoder().encode(`${location.region}\u0000${location.place}`);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `z${hex}`.slice(0, 96);
}

/** 구역의 보이는 이름 */
export function zoneLabel(location: { region: string; place: string } | undefined): string {
  return location ? `${location.region} · ${location.place}` : "세계수 도서관";
}

export type Outgoing =
  | { kind: "말"; text: string }
  | { kind: "표정"; text: string }
  | { kind: "귓속말"; to: string; text: string }
  | { kind: "거절"; reason: string };

/**
 * 입력 한 줄을 보낼 말로. `/표정 웃음` → 표정, `/귓 이름 말` → 귓속말(같은 구역의 한 사람).
 * 앞뒤 빈칸은 지우고, 빈 줄이나 너무 긴 줄은 거절.
 */
export function parseOutgoing(input: string, limits: Limits): Outgoing {
  const text = input.trim();
  if (text === "") return { kind: "거절", reason: "빈 말" };
  const max = limits.chat.maxLength;
  // 보안 규칙과 같은 세기(UTF-16 길이)
  const tooLong = (t: string) => t.length > max;
  if (text.startsWith("/표정")) {
    const expr = text.slice("/표정".length).trim();
    if (expr === "") return { kind: "거절", reason: "「/표정 웃음」처럼 표정을 적는다" };
    return tooLong(expr) ? { kind: "거절", reason: `${max}자까지` } : { kind: "표정", text: expr };
  }
  if (text.startsWith("/귓")) {
    const match = /^\/귓\s+(\S+)\s+(.+)$/.exec(text);
    if (!match) return { kind: "거절", reason: "「/귓 이름 할 말」처럼 쓴다" };
    return tooLong(match[2]!) ? { kind: "거절", reason: `${max}자까지` } : { kind: "귓속말", to: match[1]!, text: match[2]! };
  }
  if (text.startsWith("/")) return { kind: "거절", reason: "모르는 명령 (/표정, /귓)" };
  return tooLong(text) ? { kind: "거절", reason: `${max}자까지` } : { kind: "말", text };
}

/**
 * 빨리 보내기 막기: burstSeconds 안에 burstLines줄을 보냈으면, 마지막 줄부터 muteSeconds 동안 막힌다.
 * sentAt: 최근에 보낸 시각들(밀리초). 막혔으면 남은 밀리초, 아니면 0.
 */
export function chatCooldown(sentAt: readonly number[], now: number, limits: Limits): number {
  const { burstLines, burstSeconds, muteSeconds } = limits.chat;
  const recent = [...sentAt].sort((a, b) => a - b);
  // burstSeconds 안에 burstLines줄이 들어간 구간이 있으면 그 구간 마지막 줄부터 막힘
  for (let i = recent.length - 1; i >= burstLines - 1; i--) {
    const last = recent[i]!;
    const first = recent[i - burstLines + 1]!;
    if (last - first <= burstSeconds * 1000) {
      const until = last + muteSeconds * 1000;
      return until > now ? until - now : 0;
    }
  }
  return 0;
}

/** 지난 대사로 보여 줄 줄들: 시간순 마지막 historyLines줄 */
export function recentLines<T extends { at: number }>(lines: readonly T[], limits: Limits): T[] {
  return [...lines].sort((a, b) => a.at - b.at).slice(-limits.chat.historyLines);
}

/** 보관 기간이 지났는가 */
export function expired(at: number, now: number, limits: Limits): boolean {
  return now - at > limits.chat.keepDays * 24 * 60 * 60 * 1000;
}
