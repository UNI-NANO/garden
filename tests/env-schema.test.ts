import { describe, expect, it } from "vitest";
import { EnvConfigSchema } from "../src/schema/env";

const firebase = {
  apiKey: "k",
  authDomain: "demo-garden.firebaseapp.com",
  databaseURL: "http://127.0.0.1:9000?ns=demo-garden-default-rtdb",
  projectId: "demo-garden",
  storageBucket: "demo-garden.appspot.com",
  messagingSenderId: "1",
  appId: "1:1:web:1",
};
const emulator = { host: "127.0.0.1", databasePort: 9000 };

describe("환경 설정 스키마", () => {
  it("올바른 설정은 통과한다", () => {
    expect(EnvConfigSchema.safeParse({ name: "emulator", firebase, emulator }).success).toBe(true);
    expect(
      EnvConfigSchema.safeParse({ name: "prod", firebase: { ...firebase, projectId: "real" } }).success,
    ).toBe(true);
  });

  it("빈 값은 거부한다", () => {
    const bad = { name: "staging", firebase: { ...firebase, apiKey: "" } };
    expect(EnvConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("빠진 칸과 모르는 칸은 거부한다", () => {
    const { appId: _omit, ...missing } = firebase;
    void _omit;
    expect(EnvConfigSchema.safeParse({ name: "prod", firebase: missing }).success).toBe(false);
    expect(EnvConfigSchema.safeParse({ name: "prod", firebase, extra: 1 }).success).toBe(false);
  });

  it("모르는 환경 이름은 거부한다", () => {
    expect(EnvConfigSchema.safeParse({ name: "test", firebase }).success).toBe(false);
  });

  it("emulator 칸은 emulator 환경에만 허용한다", () => {
    expect(EnvConfigSchema.safeParse({ name: "prod", firebase, emulator }).success).toBe(false);
    expect(EnvConfigSchema.safeParse({ name: "emulator", firebase }).success).toBe(false);
  });

  it("emulator 환경은 demo- 프로젝트만 허용한다", () => {
    const real = { ...firebase, projectId: "hortus-qui-est-ultra" };
    expect(EnvConfigSchema.safeParse({ name: "emulator", firebase: real, emulator }).success).toBe(false);
  });
});
