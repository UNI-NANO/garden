import { describe, expect, it } from "vitest";
import { selectEnv } from "../../src/data/env";

// `npm run test:emulator`가 에뮬레이터를 띄우고 이 파일을 돌린다.
const env = selectEnv("emulator", { isTest: true });
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? `${env.emulator?.host}:${env.emulator?.databasePort}`;
const ns = `${env.firebase.projectId}-default-rtdb`;
const url = (path: string) => `http://${host}/${path}.json?ns=${ns}`;
/** 에뮬레이터 전용 관리자 토큰. 보안 규칙을 건너뛴다. 실제 서버에서는 통하지 않는다. */
const admin = { Authorization: "Bearer owner" };

describe("Realtime Database 에뮬레이터", () => {
  it("로컬 주소만 쓴다", () => {
    expect(host).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  });

  it("관리자로 쓰고 다시 읽으면 같은 값이다", async () => {
    const value = { hello: "정원", n: 1 };
    const put = await fetch(url("smoke/roundtrip"), { method: "PUT", headers: admin, body: JSON.stringify(value) });
    expect(put.status).toBe(200);
    const get = await fetch(url("smoke/roundtrip"), { headers: admin });
    expect(await get.json()).toEqual(value);
  });

  it("기본 규칙은 로그인 없는 읽기와 쓰기를 거부한다", async () => {
    const put = await fetch(url("smoke/denied"), { method: "PUT", body: JSON.stringify(1) });
    expect(put.status).toBe(401);
    const get = await fetch(url("smoke/roundtrip"));
    expect(get.status).toBe(401);
  });
});
