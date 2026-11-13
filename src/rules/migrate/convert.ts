import { CHARACTER_SCHEMA_VERSION, type Character } from "../../schema/character";
import type { Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import type { Migration } from "../../schema/defs/migration";
import type { Talent } from "../../schema/defs/talent";
import { idToKey, KEY_PATTERN } from "../../schema/keys";
import type { Secrets } from "../../schema/secrets";
import { stackKeyOf } from "../exchange";
import { seedFromString } from "../rng";
import { buildLife, monthKeyOf } from "./life-summary";
import { convertOldMastery } from "./mastery";
import type { OldBattle, OldBundle, OldPerson, OldStorySession } from "./read-old";

export interface ConvertContext {
  migration: Migration;
  limits: Limits;
  talents: readonly Talent[];
  items: readonly Item[];
  /** 옛 세계 달력 (달은 1부터) */
  calendar: { year: number; month: number };
  /** 지금 시각 (UTC 밀리초) */
  now: number;
  battles: readonly OldBattle[];
  stories: readonly OldStorySession[];
}

export interface ConvertedCharacter {
  characterId: string;
  character: Character;
  secrets: Secrets;
}

type NotMoved = NonNullable<Character["migration"]>["notMoved"][number];

/** 옛 플레이어 이름에서 늘 같은 캐릭터 ID를 만든다 (다시 실행해도 같은 자리에 쓰이게) */
export function migratedCharacterId(player: string): string {
  return `mig-${seedFromString(player).toString(16).padStart(8, "0")}`;
}

/** 능력치 누르기: keepUpTo까지는 그대로, 넘는 몫에는 factorAbove를 곱하고 내린다 */
export function squeezeAbility(migration: Migration, old: number): number {
  const { keepUpTo, factorAbove } = migration.abilities;
  return old <= keepUpTo ? old : Math.floor(keepUpTo + (old - keepUpTo) * factorAbove);
}

const ABILITY_NAMES = { health: "건강", spirit: "정신력", credit: "재력", connections: "인맥", reputation: "평판" } as const;

/** 옛 캐릭터 하나를 새 저장 모양으로 바꾼다. 짝이 없는 것은 버리지 않고 notMoved에 남긴다. */
export function convertCharacter(bundle: OldBundle, ctx: ConvertContext): ConvertedCharacter {
  const { migration, limits } = ctx;
  const { sheet, char, player } = bundle;
  const rule = migration.characters[player];
  const notMoved: NotMoved[] = [];
  const needsCheck: string[] = [...(rule?.needsCheck ?? [])];

  // 능력치
  const ability = (name: string): number => {
    const old = char.stats?.[name];
    if (old === undefined || !Number.isFinite(old) || old < limits.abilities.min || old > limits.abilities.max) {
      needsCheck.push(`능력치 「${name}」의 옛 값이 이상해서(${String(old)}) 처음 값으로 두었다.`);
      return limits.abilities.initial;
    }
    return squeezeAbility(migration, Math.round(old));
  };
  const abilities = {
    health: ability(ABILITY_NAMES.health),
    spirit: ability(ABILITY_NAMES.spirit),
    credit: ability(ABILITY_NAMES.credit),
    connections: ability(ABILITY_NAMES.connections),
    reputation: ability(ABILITY_NAMES.reputation),
  };

  // 재능
  const talentByName = (name: string, kind: Talent["kinds"][number]) => ctx.talents.find((t) => t.name === name && t.kinds.includes(kind));
  const chosen: string[] = [];
  for (const name of sheet?.talents ?? []) {
    const talent = talentByName(name, "청한");
    if (talent) chosen.push(talent.id);
    else notMoved.push({ kind: "청한 재능", name });
  }
  if (chosen.length !== limits.talents.chosen) {
    throw new Error(`${player}: 청한 재능이 ${limits.talents.chosen}개가 아니다 (${chosen.length}개)`);
  }

  const acquired: Record<string, true> = {};
  const progress: Record<string, number> = {};

  // 숙련도: 옛 기술을 새 기술로. 여러 옛 기술이 한 곳으로 모이면 환산한 뒤 더한다
  const mastery: Character["mastery"] = {};
  for (const [oldName, oldValue] of Object.entries(char.skills ?? {})) {
    const converted = convertOldMastery(migration, oldValue);
    if (converted.oddOldValue !== undefined) needsCheck.push(`기술 「${oldName}」의 옛 숙련도가 범위 밖이다 (${converted.oddOldValue}).`);

    const asTalent = migration.skillsToTalents.find((entry) => entry.from === oldName);
    if (asTalent) {
      acquired[idToKey(asTalent.talent)] = true;
      progress[idToKey(asTalent.talent)] = converted.value;
      continue;
    }
    const skill = migration.skills.find((s) => s.from.includes(oldName));
    if (!skill) {
      notMoved.push({ kind: "기술", name: oldName, detail: `옛 숙련도 ${oldValue}` });
      continue;
    }
    const key = idToKey(skill.id);
    const before = mastery[key];
    mastery[key] = {
      value: Math.min(100, (before?.value ?? 0) + converted.value),
      passed60: (before?.passed60 ?? false) || converted.passed60,
      passed80: (before?.passed80 ?? false) || converted.passed80,
    };
  }
  for (const [key, entry] of Object.entries(mastery)) {
    // 벽을 넘지 않았는데 합쳐서 벽을 넘는 값이 되면 벽 바로 아래에 멈춘다
    if (!entry.passed60 && entry.value >= 60) {
      entry.value = 59.99;
      needsCheck.push(`기술 「${key}」: 합친 숙련도가 60 벽에 걸려 59.99로 두었다.`);
    }
  }

  // 진화 이력
  const evolutions = Object.entries(char.evoFrom ?? {}).map(([name, from]) => ({ name, from: [...from] }));
  for (const evolution of evolutions) {
    const asTalent = migration.evolutionsToTalents.find((entry) => entry.from === evolution.name);
    if (asTalent) acquired[idToKey(asTalent.talent)] = true;
  }

  // 타고난 재능: 정해 둔 예외 → 옛 GM 데이터 순
  const secrets: Secrets = { hiddenPeople: [], notes: [] };
  let innate: string | undefined;
  let innateId: string | undefined;
  let innateRevealed = bundle.revealed !== undefined && bundle.revealed !== "";
  if (rule?.innate) {
    innateId = rule.innate.talent;
    innateRevealed = rule.innate.revealed;
  } else {
    const text = (bundle.gmHidden ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (text !== "" && text !== "없음") {
      innateId = talentByName(text, "타고난")?.id;
      if (innateId === undefined) notMoved.push({ kind: "타고난 재능", name: text });
    }
  }
  if (innateId !== undefined) {
    if (innateRevealed) innate = innateId;
    else secrets.innate = innateId;
  }

  // 인물
  const fromSheet: OldPerson[] = (sheet?.people ?? []).map((entry) => {
    if (typeof entry !== "string") return { name: entry.name };
    const match = /^(.*?)\s*\((.*)\)\s*$/.exec(entry);
    return match ? { name: match[1] ?? entry, rel: match[2] ?? "" } : { name: entry };
  });
  const people: Character["people"] = {};
  (bundle.people ?? fromSheet).forEach((person, index) => {
    if (person.name.trim() === "") return;
    const fixed = rule?.people.find((p) => p.name === person.name);
    const entry = {
      name: person.name,
      relation: person.rel ?? "",
      intimacy: Math.round(fixed?.intimacy ?? person.intimacy ?? migration.defaultIntimacy),
      note: person.note ?? "",
    };
    const gmNote = person.id !== undefined ? bundle.gmPeople[person.id] : undefined;
    if (gmNote) secrets.notes.push(`${person.name}: ${gmNote}`);
    if (person.hidden === true) secrets.hiddenPeople.push(entry);
    else people[person.id !== undefined && KEY_PATTERN.test(person.id) ? person.id : `p${index}`] = entry;
  });

  // 지갑과 가방
  let wallet = 0;
  const oldWallet = bundle.town?.wallet;
  if (oldWallet !== undefined) {
    if (Number.isFinite(oldWallet) && oldWallet >= 0) wallet = Math.min(limits.exchange.walletMax, Math.floor(oldWallet * migration.moneyRate));
    else needsCheck.push(`지갑의 옛 값이 이상해서(${oldWallet}) 0으로 두었다.`);
  }
  const bag: Character["bag"] = { stacks: {}, uniques: {} };
  const { freshness, quality, durability } = migration.itemDefaults;
  (bundle.town?.bag ?? []).forEach((old, index) => {
    const quantity = Math.max(1, Math.floor(old.qty ?? 1));
    const itemId = migration.items.find((entry) => entry.from === old.name)?.item;
    const item = ctx.items.find((i) => i.id === itemId);
    if (item === undefined) {
      notMoved.push({ kind: "물건", name: old.name, detail: `수량 ${quantity}${old.value !== undefined ? `, 옛 값 ${old.value}` : ""}` });
    } else if (item.kind === "묶음") {
      const key = stackKeyOf(item.id, freshness, quality);
      bag.stacks[key] = { itemId: item.id, quantity: (bag.stacks[key]?.quantity ?? 0) + quantity, freshness, quality };
    } else {
      for (let n = 0; n < quantity; n++) {
        bag.uniques[`mig-${index}-${n}`] = { itemId: item.id, enhance: 0, durability, quality };
      }
    }
  });

  // 옮길 자리가 아직 없는 것
  if (bundle.loadout) {
    const parts = [...(bundle.loadout.atk ?? []), ...(bundle.loadout.def ?? [])];
    notMoved.push({ kind: "기술 배치", name: "옛 전투 기술 배치", detail: [...parts, bundle.loadout.weapon, bundle.loadout.armor].filter(Boolean).join(", ") });
  }
  if (bundle.hasStanding) notMoved.push({ kind: "그림", name: "스탠딩 그림", detail: "별도 저장소로 옮겨야 한다" });

  // 서술과 성장기
  const detailSource = bundle.story ?? sheet?.detail;
  const detail = detailSource
    ? { temper: detailSource.temper ?? "", look: detailSource.look ?? "", quote: detailSource.quote ?? "", etc: detailSource.etc ?? "" }
    : undefined;
  const sheetEvents = sheet?.detail?.events ?? [];
  const growthSource =
    bundle.story?.events && bundle.story.events.length > 0
      ? bundle.story.events
      : (sheet?.growth ?? []).map((g, i) => {
          const fallback = sheetEvents[i];
          return { ...g, text: g.text || (typeof fallback === "string" ? fallback : "") };
        });
  const growth = growthSource
    .map((g) => ({ age: String(g.age ?? ""), title: g.title ?? "", text: g.text ?? "" }))
    .filter((g) => g.title !== "" || g.text !== "");

  // 기본 정보
  const name = (sheet?.name ?? "").trim();
  if (name === "") needsCheck.push("이름을 찾지 못했다.");
  if (!sheet?.gender) needsCheck.push("성별이 옛 데이터에 없다.");
  needsCheck.push(`출신(제국·팔군도·적국)이 옛 데이터에 없다.${sheet?.region ? ` 옛 기록의 태어난 지역: ${sheet.region}` : ""}`);
  const region = char.loc ?? sheet?.loc;
  const place = char.place ?? sheet?.place;

  const visited = new Set<string>();
  for (const r of [sheet?.loc, char.loc, ...(bundle.town?.quests ?? []).map((q) => q.region)]) if (r) visited.add(r);
  for (const story of ctx.stories) if (story.region && (story.members ?? []).includes(player)) visited.add(story.region);
  for (const battle of ctx.battles) if (battle.region && (battle.members ?? []).includes(player)) visited.add(battle.region);

  const character: Character = {
    meta: {
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      founder: true,
      rev: 0,
      stage: char.dead ? "죽음" : "살아 있음",
      createdAt: ctx.now,
    },
    profile: {
      name: name === "" ? "이름 없음" : name,
      ...(sheet?.gender ? { gender: sheet.gender } : {}),
      age: Math.max(0, Math.round(char.age ?? sheet?.age ?? 0)),
      imperialResident: false,
      ...(sheet?.family ? { family: sheet.family } : {}),
      ...(char.job ? { job: { name: char.job, stage: char.stage ?? "", ...(char.workplace ? { workplace: char.workplace } : {}) } } : {}),
      ...(region && place ? { location: { region, place } } : {}),
      marks: [...(sheet?.marks ?? [])],
      ...(detail ? { detail } : {}),
    },
    abilities,
    talents: { chosen, ...(innate !== undefined ? { innate } : {}), acquired, progress },
    mastery,
    trees: {},
    loadout: { basics: [] },
    wallet,
    bag,
    month: {
      key: monthKeyOf(ctx.calendar.year, ctx.calendar.month),
      mainActions: limits.month.mainActions,
      minorActions: limits.month.minorActions,
      savedActions: 0,
      career: 0,
      learnCounts: {},
      combatMasteryGained: {},
      fatigue: {},
    },
    claimedRewards: {},
    mailbox: {},
    people,
    growth,
    evolutions,
    life: buildLife(bundle, ctx.battles, ctx.stories),
    visitedRegions: [...visited],
    migration: { oldPlayer: player, migratedAt: ctx.now, notMoved, needsCheck },
  };
  return { characterId: migratedCharacterId(player), character, secrets };
}
