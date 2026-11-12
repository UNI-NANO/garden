import { describe, expect, it } from "vitest";
import { EnvError, selectEnv } from "../src/data/env";

describe("환경 고르기", () => {
  it("이름이 없으면 emulator", () => {
    expect(selectEnv(undefined, { isTest: true }).name).toBe("emulator");
  });

  it("emulator는 로컬 주소와 demo 프로젝트만 가리킨다", () => {
    const env = selectEnv("emulator", { isTest: true });
    expect(env.firebase.projectId).toBe("demo-garden");
    expect(new URL(env.firebase.databaseURL).hostname).toBe("127.0.0.1");
  });

  it("자동 테스트 중에는 prod와 staging을 거부한다", () => {
    expect(() => selectEnv("prod", { isTest: true })).toThrow(EnvError);
    expect(() => selectEnv("staging", { isTest: true })).toThrow(EnvError);
  });

  it("prod는 실제 프로젝트를 가리키고 에뮬레이터 칸이 없다", () => {
    const env = selectEnv("prod", { isTest: false });
    expect(env.firebase.projectId).toBe("hortus-qui-est-ultra");
    expect(env.emulator).toBeUndefined();
  });

  it("값이 빈 staging은 고르는 순간 실패한다", () => {
    expect(() => selectEnv("staging", { isTest: false })).toThrow(/비었거나/);
  });

  it("모르는 이름은 거부한다", () => {
    expect(() => selectEnv("production", { isTest: false })).toThrow(EnvError);
    expect(() => selectEnv("", { isTest: false })).toThrow(EnvError);
  });
});
