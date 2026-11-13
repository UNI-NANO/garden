import { describe, expect, it } from "vitest";
import rawItems from "../data/defs/items.json";
import rawMigration from "../data/defs/migration.json";
import rawTalents from "../data/defs/talents.json";
import { convertCharacter, migratedCharacterId, squeezeAbility, type ConvertContext } from "../src/rules/migrate/convert";
import { readOldData } from "../src/rules/migrate/read-old";
import { characterSchema } from "../src/schema/character";
import { ItemListSchema } from "../src/schema/defs/item";
import { MigrationSchema } from "../src/schema/defs/migration";
import { TalentListSchema } from "../src/schema/defs/talent";
import { SecretsSchema } from "../src/schema/secrets";
import { sampleChars, sampleExport } from "./fixtures/old-sample";
import { limits, NOW } from "./helpers/fake-character";

const baseMigration = MigrationSchema.parse(rawMigration);
// 견본 플레이어에게 예외 하나를 걸어 본다 (실제 예외는 실제 플레이어 이름에 걸려 있다)
const migration = MigrationSchema.parse({
  ...rawMigration,
  characters: {
    가람: { people: [{ name: "벨로 경", intimacy: 70 }], needsCheck: ["정해 둔 메모"] },
    나루: { innate: { talent: "piercing-eye", revealed: false } },
  },
});
const old = readOldData(sampleExport(), sampleChars());
const ctx: ConvertContext = {
  migration,
  limits,
  talents: TalentListSchema.parse(rawTalents).talents,
  items: ItemListSchema.parse(rawItems).items,
  calendar: old.calendar ?? { year: 0, month: 1 },
  now: NOW,
  battles: old.battles,
  stories: old.stories,
};
const convert = (player: string, context = ctx) => {
  const bundle = old.characters.find((c) => c.player === player);
  if (!bundle) throw new Error(`견본에 ${player} 없음`);
  return convertCharacter(bundle, context);
};
const schema = characterSchema(limits);

describe("옛 데이터 읽기", () => {
  it("캐릭터별로 묶는다", () => {
    expect(old.characters.map((c) => c.player)).toEqual(["new-abc123", "가람", "나루"]);
    expect(old.calendar).toEqual({ year: 514, month: 1 });
    expect(old.problems).toEqual([]);
  });
  it("소스의 CHARS, extra, grown을 합친다", () => {
    const names = Object.fromEntries(old.characters.map((c) => [c.player, c.sheet?.name]));
    expect(names).toEqual({ "new-abc123": "하루", 가람: "아린 벨로", 나루: "세라 온" });
    // grown이 CHARS의 처음 값을 덮어쓴다
    expect(old.characters.find((c) => c.player === "나루")?.sheet?.marks).toEqual(["「축복받은 아이」"]);
  });
  it("버리는 것은 개수만 센다", () => {
    expect(old.skipped).toEqual({
      암호: 1,
      채팅: 1,
      "전투 계획": 1,
      "전투 호출": 1,
      "접속 표시": 1,
      "생성 요청 목록(암호 해시 포함)": 1,
      "지역 게시판": 1,
      "옛 GM 정의 데이터": 1,
      "생성 요청의 GM 메모": 1,
      "짝이 없는 키": 1,
    });
  });
  it("월간 기록을 달 순서로 읽는다", () => {
    const months = old.characters.find((c) => c.player === "가람")?.months ?? [];
    expect(months.map((m) => m.month)).toEqual([9, 10]);
  });
  it("암호와 채팅은 읽은 결과 어디에도 없다", () => {
    const text = JSON.stringify(old);
    expect(text).not.toContain("SECRET-PASSWORD-HASH");
    expect(text).not.toContain("비밀 채팅");
  });
  it("값이 깨진 키는 건너뛰고 알린다", () => {
    const broken = sampleExport();
    broken.store[encodeURIComponent("jpg-town-char-가람")] = JSON.stringify({ wallet: "많음" });
    const result = readOldData(broken, sampleChars());
    expect(result.problems).toEqual(["jpg-town-char-가람: 모양이 달라 읽지 못했다"]);
    expect(result.characters.find((c) => c.player === "가람")?.town).toBeUndefined();
  });
});

describe("캐릭터 변환", () => {
  it("변환한 캐릭터와 비밀은 모두 스키마를 통과한다", () => {
    for (const bundle of old.characters) {
      const result = convertCharacter(bundle, ctx);
      expect(schema.safeParse(result.character).error?.issues ?? []).toEqual([]);
      expect(SecretsSchema.safeParse(result.secrets).success).toBe(true);
    }
  });
  it("기본 정보: 주인 없음, 창립 멤버, 세계 달력의 달", () => {
    const { character, characterId } = convert("가람");
    expect(characterId).toBe(migratedCharacterId("가람"));
    expect(characterId).toMatch(/^mig-[0-9a-f]{8}$/);
    expect(character.meta).toMatchObject({ founder: true, rev: 0, stage: "살아 있음" });
    expect(character.meta.owner).toBeUndefined();
    expect(character.profile).toMatchObject({
      name: "아린 벨로",
      age: 17,
      job: { name: "기사", stage: "종자", workplace: "북쪽 팔" },
      location: { region: "북쪽 팔", place: "어느 영주성" },
      marks: ["「평온한 출생」"],
    });
    expect(character.month).toMatchObject({ key: "514-0", mainActions: 4, minorActions: 2, savedActions: 0 });
  });
  it("능력치: 50을 넘는 몫만 절반으로", () => {
    expect([100, 91, 61, 51, 50, 44, 0].map((v) => squeezeAbility(migration, v))).toEqual([75, 70, 55, 50, 50, 44, 0]);
    expect(convert("가람").character.abilities).toEqual({ health: 75, spirit: 70, credit: 44, connections: 55, reputation: 50 });
  });
  it("범위 밖 능력치는 처음 값으로 두고 확인 목록에 남긴다", () => {
    const { character } = convert("new-abc123");
    expect(character.abilities.reputation).toBe(limits.abilities.initial);
    expect(character.migration?.needsCheck.some((n) => n.includes("평판"))).toBe(true);
  });
  it("숙련도: 환산하고, 한 나무로 모이는 옛 기술은 더한다", () => {
    const { mastery } = convert("가람").character;
    expect(mastery["sword"]).toEqual({ value: 72, passed60: true, passed80: false });
    expect(mastery["rapier"]).toEqual({ value: 22, passed60: false, passed80: false });
    expect(mastery["riding"]?.value).toBe(18);
    expect(mastery["hunting"]?.value).toBe(14);
    expect(convert("나루").character.mastery["prayer"]?.value).toBe(22);
  });
  it("짝이 없는 기술·물건은 버리지 않고 옮기지 못한 것에 남긴다", () => {
    const notMoved = convert("가람").character.migration?.notMoved ?? [];
    expect(notMoved).toContainEqual({ kind: "기술", name: "없는 기술", detail: "옛 숙련도 30" });
    expect(notMoved).toContainEqual({ kind: "물건", name: "수수께끼의 돌", detail: "수량 3, 옛 값 99" });
    expect(notMoved.map((n) => n.kind)).toEqual(expect.arrayContaining(["기술 배치", "그림"]));
  });
  it("진화: 옛 기술 백병술과 진화 이력 검무는 얻은 재능이 된다", () => {
    const { talents, evolutions, mastery } = convert("가람").character;
    expect(talents.acquired).toEqual({ "melee-arts": true, "sword-dance": true });
    expect(talents.progress).toEqual({ "melee-arts": 41 });
    expect(evolutions).toEqual([{ name: "검무", from: ["곡예", "검술"] }]);
    expect(Object.keys(mastery)).not.toContain("melee-arts");
  });
  it("청한 재능은 ID로 옮긴다", () => {
    expect(convert("가람").character.talents.chosen).toEqual(["agility", "sturdy", "intuition"]);
    expect(convert("new-abc123").character.talents.chosen).toEqual(["learning", "charm", "voice"]);
  });
  it("타고난 재능: 드러난 것은 캐릭터에, 숨은 것은 비밀에", () => {
    const shown = convert("가람");
    expect(shown.character.talents.innate).toBe("sword-gift");
    expect(shown.secrets.innate).toBeUndefined();

    const hidden = convert("new-abc123");
    expect(hidden.character.talents.innate).toBeUndefined();
    expect(hidden.secrets.innate).toBe("herb-nose");
    expect(JSON.stringify(hidden.character)).not.toContain("herb-nose");
  });
  it("정해 둔 예외가 옛 GM 데이터보다 앞선다", () => {
    // 옛 GM 데이터는 "없음"이지만 예외로 정해 둔 타고난 재능이 들어간다
    const { character, secrets } = convert("나루");
    expect(secrets.innate).toBe("piercing-eye");
    expect(character.talents.innate).toBeUndefined();
    // 친밀도 예외와 메모
    const garam = convert("가람").character;
    expect(garam.people["ab12cd"]).toEqual({ name: "벨로 경", relation: "아버지", intimacy: 70, note: "엄한 사람" });
    expect(garam.migration?.needsCheck).toContain("정해 둔 메모");
    expect(convertCharacter(old.characters[1]!, { ...ctx, migration: baseMigration }).character.people["ab12cd"]?.intimacy).toBe(65);
  });
  it("인물: 숨은 인물과 GM 메모는 비밀로, 친밀도가 없으면 옛 기본값", () => {
    const { character, secrets } = convert("가람");
    expect(Object.values(character.people).map((p) => p.name)).toEqual(["벨로 경"]);
    expect(secrets.hiddenPeople.map((p) => p.name)).toEqual(["숨은 후견인"]);
    expect(secrets.notes).toEqual(["벨로 경: 사실은 원수의 친구"]);
    expect(JSON.stringify(character)).not.toContain("원수의 친구");

    expect(convert("나루").character.people).toEqual({ p0: { name: "온 부인", relation: "어머니", intimacy: 50, note: "" } });
  });
  it("지갑은 옛 1 = 잎전 1, 물건은 새 물건으로", () => {
    const { wallet, bag } = convert("가람").character;
    expect(wallet).toBe(154);
    expect(bag.stacks).toEqual({ "rabbit-meat-f100-q1": { itemId: "rabbit-meat", quantity: 3, freshness: 100, quality: "중" } });
    expect(Object.values(bag.uniques)).toEqual([{ itemId: "knights-longsword", enhance: 0, durability: 100, quality: "중" }]);
    expect(convert("new-abc123").character.wallet).toBe(0);
  });
  it("서술과 성장기", () => {
    const garam = convert("가람").character;
    expect(garam.profile.detail).toEqual({ temper: "조용하다", look: "키가 크다", quote: "…", etc: "" });
    expect(garam.growth).toEqual([{ age: "10세", title: "첫 검", text: "목검을 받았다." }]);
    // 사건 글이 따로 적힌 경우 성장기 칸에 채운다. 제목도 글도 없는 줄은 뺀다... 글이 있으면 남는다
    expect(convert("나루").character.growth).toEqual([
      { age: "0", title: "출생", text: "태어났다" },
      { age: "5", title: "", text: "자랐다" },
    ]);
  });
  it("지난 삶 요약: 달, 이야기, 전투를 한 줄씩. 이야기에 딸린 전투와 끝나지 않은 전투는 뺀다", () => {
    expect(convert("가람").character.life).toEqual([
      { kind: "달", when: "513-8", text: "일하기(영주성) 보통" },
      { kind: "달", when: "513-9", text: "배우기(검술 · 아버지에게) 성공, 쉬기" },
      { kind: "이야기", text: "「늑대 토벌」 (북쪽 팔) — 실패" },
      { kind: "전투", text: "「훈련장 대련」 (북쪽 팔) — 승리" },
    ]);
    expect(convert("나루").character.life).toEqual([{ kind: "이야기", text: "「서신 배달」 (황도) — 마침" }]);
  });
  it("가본 지역", () => {
    expect(convert("가람").character.visitedRegions.sort()).toEqual(["북쪽 팔", "소프레고", "황도"]);
  });
  it("출신과 성별이 없으면 비워 두고 확인 목록에 남긴다", () => {
    const { profile, migration: record } = convert("가람").character;
    expect(profile.origin).toBeUndefined();
    expect(profile.gender).toBeUndefined();
    expect(record?.needsCheck.some((n) => n.includes("성별"))).toBe(true);
    expect(record?.needsCheck.some((n) => n.includes("출신"))).toBe(true);
    expect(convert("나루").character.profile.gender).toBe("여성");
  });
  it("암호는 변환 결과 어디에도 없다", () => {
    const all = JSON.stringify(old.characters.map((b) => convertCharacter(b, ctx)));
    expect(all).not.toContain("SECRET-PASSWORD-HASH");
    expect(all).not.toContain("비밀 채팅");
  });
  it("같은 입력이면 같은 결과", () => {
    expect(convert("가람")).toEqual(convert("가람"));
  });
  it("청한 재능이 셋이 아니면 옮기지 않고 멈춘다", () => {
    const chars = sampleChars();
    (chars[0] as { talents: string[] }).talents = ["민첩"];
    const bad = readOldData(sampleExport(), chars).characters.find((c) => c.player === "가람");
    expect(() => convertCharacter(bad!, ctx)).toThrow(/청한 재능/);
  });
});
