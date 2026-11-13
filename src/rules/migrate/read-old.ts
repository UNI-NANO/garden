import { z } from "zod";

/**
 * 옛 사이트의 데이터를 읽어 캐릭터별로 묶는다.
 * - 내보내기 파일의 `store`·`gm` (키는 URL 인코딩, 값은 JSON 문자열)
 * - 옛 사이트 소스에 박혀 있던 `CHARS` 목록 (이름·청한 재능·기억 표시·성장기 인물)
 * 버리는 것(접속 표시, 채팅, 파티, 결투, 게시판, 우편, 암호)은 값을 읽지 않고 개수만 센다.
 */

const num = z.number();
const str = z.string();
const stats = z.record(str, num);
const ym = z.looseObject({ year: num, month: num });

/** 옛 소스의 CHARS, 내보내기의 extra·grown: 캐릭터를 만들 때의 값 */
const SheetSchema = z.looseObject({
  tab: str.optional(),
  name: str.optional(),
  gender: str.optional(),
  age: num.optional(),
  region: str.optional(),
  family: str.optional(),
  loc: str.optional(),
  place: str.optional(),
  talents: z.array(str).optional(),
  people: z.array(z.union([str, z.looseObject({ name: str })])).optional(),
  marks: z.array(str).optional(),
  detail: z
    .looseObject({ events: z.array(z.unknown()).optional(), temper: str.optional(), look: str.optional(), quote: str.optional(), etc: str.optional() })
    .optional(),
  growth: z.array(z.looseObject({ age: z.union([num, str]).optional(), title: str.optional(), text: str.optional() })).optional(),
});
export type OldSheet = z.infer<typeof SheetSchema>;

/** jpg-home-char-<플레이어>: 지금의 값 */
const CharSchema = z.looseObject({
  loc: str.optional(),
  place: str.optional(),
  stats: stats.optional(),
  skills: z.record(str, num).optional(),
  age: num.optional(),
  job: str.optional(),
  stage: str.optional(),
  workplace: str.optional(),
  dead: z.unknown().optional(),
  evoFrom: z.record(str, z.array(str)).optional(),
});
export type OldChar = z.infer<typeof CharSchema>;

const PersonSchema = z.looseObject({
  id: str.optional(),
  name: str,
  rel: str.optional(),
  intimacy: num.optional(),
  note: str.optional(),
  hidden: z.boolean().nullish(),
});
export type OldPerson = z.infer<typeof PersonSchema>;

const StorySchema = z.looseObject({
  events: z.array(z.looseObject({ age: z.union([num, str]).optional(), title: str.optional(), text: str.optional() })).optional(),
  temper: str.optional(),
  look: str.optional(),
  quote: str.optional(),
  etc: str.optional(),
});

const TownSchema = z.looseObject({
  wallet: num.optional(),
  bag: z.array(z.looseObject({ name: str, qty: num.optional(), value: num.optional(), id: str.optional() })).optional(),
  quests: z.array(z.looseObject({ region: str.optional() })).optional(),
});

const LoadoutSchema = z.looseObject({ atk: z.array(str).optional(), def: z.array(str).optional(), weapon: str.optional(), armor: str.optional() });

const SubSchema = z.looseObject({
  ym: ym.optional(),
  queue: z.array(z.looseObject({ n: str.optional(), detail: str.optional(), res: str.optional() })).optional(),
});

const BattleSchema = z.looseObject({
  id: str,
  title: str.optional(),
  region: str.optional(),
  mode: str.optional(),
  phase: str.optional(),
  result: str.nullish(),
  members: z.array(str).optional(),
});
export type OldBattle = z.infer<typeof BattleSchema>;

const StorySessionSchema = z.looseObject({
  sid: str,
  title: str.optional(),
  region: str.optional(),
  phase: str.optional(),
  result: str.nullish(),
  members: z.array(str).optional(),
  battleId: str.nullish(),
});
export type OldStorySession = z.infer<typeof StorySessionSchema>;

export interface OldBundle {
  /** 옛 저장 키에 쓰인 플레이어 이름 */
  player: string;
  sheet: OldSheet | undefined;
  char: OldChar;
  people: OldPerson[] | undefined;
  story: z.infer<typeof StorySchema> | undefined;
  town: z.infer<typeof TownSchema> | undefined;
  loadout: z.infer<typeof LoadoutSchema> | undefined;
  hasStanding: boolean;
  /** 플레이어에게 드러난 타고난 재능 */
  revealed: string | undefined;
  /** GM만 보던 타고난 재능 (예: "검의 재능 (흔함)", "없음") */
  gmHidden: string | undefined;
  /** GM만 보던 인물 메모: 인물 ID → 메모 */
  gmPeople: Record<string, string>;
  /** 월간 제출 */
  months: { year: number; month: number; actions: { name: string; detail: string; result: string }[] }[];
}

export interface OldData {
  calendar: { year: number; month: number } | undefined;
  characters: OldBundle[];
  battles: OldBattle[];
  stories: OldStorySession[];
  /** 옮기지 않고 버린 것: 갈래 → 개수 */
  skipped: Record<string, number>;
  /** 읽지 못한 키 */
  problems: string[];
}

/** 값을 읽지 않고 버리는 키. 앞에서부터 맞춰 본다 */
const SKIP: [prefix: string, label: string][] = [
  ["jpg-home-pw-", "암호"],
  ["jpg-req-list", "생성 요청 목록(암호 해시 포함)"],
  ["jpg-home-presence", "접속 표시"],
  ["jpg-home-chat-", "채팅"],
  ["jpg-home-party-", "파티"],
  ["jpg-home-myparty-", "파티"],
  ["jpg-duel-", "결투 신청"],
  ["jpg-town-board-", "지역 게시판"],
  ["jpg-town-mail-", "우편"],
  ["jpg-town-npcmail", "우편"],
  ["jpg-home-news", "소식"],
  ["jpg-home-btlgain-", "이번 달 전투 숙련 기록"],
  ["jpg-btl-calls", "전투 호출"],
  ["jpg-home-skilldef", "옛 GM 정의 데이터"],
  ["jpg-home-gmhidden-req-", "생성 요청의 GM 메모"],
];

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function readOldData(exported: unknown, chars: readonly unknown[]): OldData {
  const root = z.looseObject({ store: z.record(str, z.unknown()), gm: z.record(str, z.unknown()).optional() }).parse(exported);
  const skipped: Record<string, number> = {};
  const problems: string[] = [];
  const skip = (label: string) => {
    skipped[label] = (skipped[label] ?? 0) + 1;
  };

  // 값을 읽어도 되는 키만 풀어 둔다
  const store = new Map<string, unknown>();
  for (const [rawKey, value] of Object.entries(root.store)) {
    const key = decodeKey(rawKey);
    const rule = SKIP.find(([prefix]) => key.startsWith(prefix));
    if (rule) skip(rule[1]);
    else if (key.startsWith("jpg-btl-") && key.includes("-plan-")) skip("전투 계획");
    else if (/^jpg-(btl|story)-.*-hb$/.test(key)) skip("전투·이야기 접속 표시");
    else store.set(key, parseValue(value));
  }
  const gm = new Map<string, unknown>();
  for (const [rawKey, value] of Object.entries(root.gm ?? {})) {
    const key = decodeKey(rawKey);
    if (SKIP.some(([prefix]) => key.startsWith(prefix))) skip("생성 요청의 GM 메모");
    else gm.set(key, parseValue(value));
  }

  const used = new Set<string>();
  const take = <T>(key: string, schema: z.ZodType<T>, source: Map<string, unknown> = store): T | undefined => {
    if (!source.has(key)) return undefined;
    used.add(key);
    const parsed = schema.safeParse(source.get(key));
    if (parsed.success) return parsed.data;
    problems.push(`${key}: 모양이 달라 읽지 못했다`);
    return undefined;
  };

  const sheets = new Map<string, OldSheet>();
  for (const raw of [...chars, ...(take("jpg-home-extra", z.array(z.unknown())) ?? [])]) {
    const sheet = SheetSchema.safeParse(raw);
    if (sheet.success && sheet.data.tab !== undefined) sheets.set(sheet.data.tab, sheet.data);
  }

  const CHAR = "jpg-home-char-";
  const SUB = /^jpg-day-sub-(\d+)-(\d+)-(.+)$/;
  const characters: OldBundle[] = [];
  for (const key of [...store.keys()].filter((k) => k.startsWith(CHAR)).sort()) {
    const player = key.slice(CHAR.length);
    const char = take(key, CharSchema);
    if (char === undefined) continue;

    // 성장기를 사이트에서 마친 캐릭터는 grown이 처음 값을 덮어쓴다
    const grown = take(`jpg-home-grown-${player}`, SheetSchema);
    const base = sheets.get(player);
    const sheet = base !== undefined || grown !== undefined ? { ...base, ...grown } : undefined;

    const months: OldBundle["months"] = [];
    for (const subKey of store.keys()) {
      const match = SUB.exec(subKey);
      if (match === null || match[3] !== player) continue;
      const sub = take(subKey, SubSchema);
      if (sub === undefined) continue;
      months.push({
        year: Number(match[1]),
        month: Number(match[2]),
        actions: (sub.queue ?? []).map((q) => ({ name: q.n ?? "", detail: q.detail ?? "", result: q.res ?? "" })),
      });
    }
    months.sort((a, b) => a.year - b.year || a.month - b.month);

    const revealed = take(`jpg-home-revealed-${player}`, str);
    const gmHidden = take(`jpg-home-gmhidden-${player}`, str, gm);
    characters.push({
      player,
      sheet,
      char,
      people: take(`jpg-home-people-${player}`, z.array(PersonSchema)),
      story: take(`jpg-home-story-${player}`, StorySchema),
      town: take(`jpg-town-char-${player}`, TownSchema),
      loadout: take(`jpg-home-loadout-${player}`, LoadoutSchema),
      hasStanding: store.has(`jpg-home-stand-${player}`),
      revealed,
      gmHidden,
      gmPeople: take(`jpg-home-gmhidden-people-${player}`, z.record(str, str), gm) ?? {},
      months,
    });
    used.add(`jpg-home-stand-${player}`);
  }

  const battles: OldBattle[] = [];
  const stories: OldStorySession[] = [];
  for (const key of store.keys()) {
    if (key.startsWith("jpg-btl-")) {
      const battle = take(key, BattleSchema);
      if (battle) battles.push(battle);
    } else if (key.startsWith("jpg-story-")) {
      const story = take(key, StorySessionSchema);
      if (story) stories.push(story);
    }
  }
  battles.sort((a, b) => a.id.localeCompare(b.id));
  stories.sort((a, b) => a.sid.localeCompare(b.sid));

  const calendar = take("jpg-day-cal", ym);
  for (const key of store.keys()) if (!used.has(key)) skip("짝이 없는 키");
  for (const key of gm.keys()) if (!used.has(key)) skip("짝이 없는 GM 키");

  return {
    calendar: calendar ? { year: calendar.year, month: calendar.month } : undefined,
    characters,
    battles,
    stories,
    skipped,
    problems,
  };
}
