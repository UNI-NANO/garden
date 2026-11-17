import { describe, expect, it } from "vitest";
import rawLimits from "../data/defs/limits.json";
import { chatCooldown, expired, LIBRARY_ZONE, parseOutgoing, recentLines, zoneKeyOf, zoneLabel } from "../src/rules/chat";
import { KEY_PATTERN } from "../src/schema/keys";
import { LimitsSchema } from "../src/schema/defs/limits";

const limits = LimitsSchema.parse(rawLimits);

describe("구역", () => {
  it("장소 하나가 한 구역, 위치가 없으면 도서관", () => {
    const inn = zoneKeyOf({ region: "황도", place: "여관" });
    expect(inn).toMatch(KEY_PATTERN);
    expect(zoneKeyOf({ region: "황도", place: "여관" })).toBe(inn);
    expect(zoneKeyOf({ region: "황도", place: "장터" })).not.toBe(inn);
    // 지역과 장소의 경계가 섞이지 않는다
    expect(zoneKeyOf({ region: "황도여", place: "관" })).not.toBe(inn);
    expect(zoneKeyOf(undefined)).toBe(LIBRARY_ZONE);
    expect([zoneLabel({ region: "황도", place: "여관" }), zoneLabel(undefined)]).toEqual(["황도 · 여관", "세계수 도서관"]);
  });
});

describe("보낼 말", () => {
  it("말, /표정, /귓", () => {
    expect(parseOutgoing("  안녕  ", limits)).toEqual({ kind: "말", text: "안녕" });
    expect(parseOutgoing("/표정 웃음", limits)).toEqual({ kind: "표정", text: "웃음" });
    expect(parseOutgoing("/귓 하린 잠깐 와 봐", limits)).toEqual({ kind: "귓속말", to: "하린", text: "잠깐 와 봐" });
  });
  it("빈 줄, 너무 긴 줄, 모르는 명령은 거절", () => {
    expect(parseOutgoing("   ", limits)).toMatchObject({ kind: "거절" });
    expect(parseOutgoing("가".repeat(200), limits)).toMatchObject({ kind: "말" });
    expect(parseOutgoing("가".repeat(201), limits)).toEqual({ kind: "거절", reason: "200자까지" });
    expect(parseOutgoing("/귓 하린", limits)).toMatchObject({ kind: "거절" });
    expect(parseOutgoing("/춤", limits)).toMatchObject({ kind: "거절" });
  });
});

describe("빨리 보내기 막기", () => {
  it("10초 안에 5줄이면 마지막 줄부터 30초 막힘", () => {
    const s = 1_000_000;
    const five = [s, s + 1000, s + 2000, s + 3000, s + 4000];
    expect(chatCooldown(five.slice(0, 4), s + 4000, limits)).toBe(0);
    expect(chatCooldown(five, s + 4000, limits)).toBe(30_000);
    expect(chatCooldown(five, s + 4000 + 29_000, limits)).toBe(1000);
    expect(chatCooldown(five, s + 4000 + 30_000, limits)).toBe(0);
    // 천천히 보내면 막히지 않는다
    expect(chatCooldown([s, s + 3000, s + 6000, s + 9000, s + 12_000], s + 12_000, limits)).toBe(0);
  });
  it("지난 대사는 시간순 마지막 30줄, 7일 지나면 지운다", () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ at: 40 - i }));
    expect(recentLines(lines, limits).map((l) => l.at)).toEqual(Array.from({ length: 30 }, (_, i) => i + 11));
    const day = 86_400_000;
    expect([expired(0, 7 * day, limits), expired(0, 7 * day + 1, limits)]).toEqual([false, true]);
  });
});
