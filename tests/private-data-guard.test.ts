import { describe, expect, it } from "vitest";
import { findPrivateData } from "../src/data/private-data-guard";

describe("비공개 데이터 지킴이", () => {
  it("보통 파일은 통과한다", () => {
    expect(
      findPrivateData([
        { path: "src/main.ts" },
        { path: "data/defs/limits.json", content: '{"id":"limits"}' },
        { path: "docs/old/old-site-index.html" },
      ]),
    ).toEqual([]);
  });
  it("내보내기 파일 이름을 잡는다", () => {
    expect(findPrivateData([{ path: "docs/old/firebase-export.json", content: "{}" }])).toHaveLength(1);
    expect(findPrivateData([{ path: "hortus-default-rtdb-export (2).json", content: "{}" }])).toHaveLength(1);
  });
  it("이름을 바꿔도 내용으로 잡는다", () => {
    const content = '{"store":{"jpg-home-char-someone":"{}"}}';
    expect(findPrivateData([{ path: "data/backup.json", content }])).toEqual([
      { path: "data/backup.json", why: "옛 사이트의 저장 데이터가 들어 있음" },
    ]);
  });
  it("변환 결과 폴더를 잡는다", () => {
    expect(findPrivateData([{ path: "migration-out/characters.json", content: "{}" }])).toHaveLength(1);
  });
  it("가짜 데이터로 만든 견본은 허용한다", () => {
    const content = '{"store":{"jpg-home-char-sample":"{}"}}';
    expect(findPrivateData([{ path: "tests/fixtures/old-store.sample.json", content }])).toEqual([]);
    expect(findPrivateData([{ path: "tests/fixtures/real.json", content }])).toHaveLength(1);
  });
});
