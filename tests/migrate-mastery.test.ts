import { describe, expect, it } from "vitest";
import rawMigration from "../data/defs/migration.json";
import rawTable from "../data/defs/skill-table.json";
import { branchPoints, rootPoints } from "../src/rules/mastery";
import { convertOldMastery } from "../src/rules/migrate/mastery";
import { MigrationSchema } from "../src/schema/defs/migration";
import { SkillTableSchema } from "../src/schema/defs/skill-table";

const migration = MigrationSchema.parse(rawMigration);
const table = SkillTableSchema.parse(rawTable);
const convert = (old: number) => convertOldMastery(migration, old);
const points = (mastery: number) => [branchPoints(table, mastery), rootPoints(table, mastery)];

describe("옛 숙련도 환산", () => {
  it("구간의 끝은 정해진 값으로 간다", () => {
    expect([0, 30, 60, 80, 100].map((old) => convert(old).value)).toEqual([0, 25, 45, 60, 75]);
  });
  it("기획서 「캐릭터별 나무 점수」의 값과 맞는다", () => {
    // 전바섬 검술 96 → 72 (18/7, 60 벽 통과)
    expect(convert(96)).toEqual({ value: 72, passed60: true, passed80: false });
    expect(points(72)).toEqual([18, 7]);
    // 볼카누스 그라비다드 칼다레 68 → 51 (12/5)
    expect(convert(68).value).toBe(51);
    expect(points(51)).toEqual([12, 5]);
    // 아스테리스 검술 40 → 32 (8/3)
    expect(convert(40).value).toBe(32);
    expect(points(32)).toEqual([8, 3]);
  });
  it("환산값에서 나오는 점수 (기획서 표의 나머지 줄)", () => {
    expect(points(22)).toEqual([5, 2]);
    expect(points(21)).toEqual([5, 2]);
    expect(points(19)).toEqual([4, 1]);
    expect(points(11)).toEqual([2, 1]);
    expect(branchPoints(table, 18)).toBe(4);
    expect(branchPoints(table, 4)).toBe(1);
  });
  it("옛 80 이상만 60 벽을 넘은 것으로 인정한다", () => {
    expect(convert(79).passed60).toBe(false);
    expect(convert(80).passed60).toBe(true);
    expect(convert(100)).toMatchObject({ value: 75, passed60: true, passed80: false });
  });
  it("옛 값이 클수록 새 값도 크거나 같다", () => {
    let before = -1;
    for (let old = 0; old <= 100; old++) {
      const value = convert(old).value;
      expect(value).toBeGreaterThanOrEqual(before);
      before = value;
    }
  });
  it("범위 밖의 이상한 옛 값은 끝값으로 맞추고 표시를 남긴다", () => {
    expect(convert(130)).toEqual({ value: 75, passed60: true, passed80: false, oddOldValue: 130 });
    expect(convert(-5)).toEqual({ value: 0, passed60: false, passed80: false, oddOldValue: -5 });
    expect(convert(Number.NaN).value).toBe(0);
  });
  it("진화 재능의 가지 점수는 더해진다", () => {
    expect(branchPoints(table, 100)).toBe(25);
    expect(branchPoints(table, 100, 2)).toBe(27);
    expect(rootPoints(table, 100)).toBe(10);
  });
});
