import type { EnvConfig } from "../schema/env";
import type { AdminPort } from "./migrate-write";

/**
 * 에뮬레이터의 관리자 창구 (REST). 에뮬레이터 전용 토큰으로 보안 규칙을 건너뛴다.
 * 이 토큰은 실제 서버에서는 통하지 않고, 주소도 로컬만 허용한다.
 */
export function emulatorAdminPort(env: EnvConfig, options: { host?: string | undefined; namespace?: string } = {}): AdminPort {
  if (env.name !== "emulator" || env.emulator === undefined) throw new Error("에뮬레이터 환경이 아니다");
  const host = options.host ?? `${env.emulator.host}:${env.emulator.databasePort}`;
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error(`에뮬레이터가 아닌 주소: ${host}`);
  // 에뮬레이터는 이름(ns)마다 데이터베이스가 따로다. 기본은 환경 설정의 주소에 적힌 이름
  const namespace = options.namespace ?? new URL(env.firebase.databaseURL).searchParams.get("ns") ?? `${env.firebase.projectId}-default-rtdb`;
  const url = (path: string) => `http://${host}/${path}.json?ns=${namespace}`;
  const headers = { Authorization: "Bearer owner", "Content-Type": "application/json" };

  return {
    get: async (path) => {
      const response = await fetch(url(path), { headers });
      if (!response.ok) throw new Error(`읽기 실패 (${response.status}): ${path}`);
      return (await response.json()) as unknown;
    },
    update: async (updates) => {
      const response = await fetch(url(""), { method: "PATCH", headers, body: JSON.stringify(updates) });
      if (!response.ok) throw new Error(`쓰기 실패 (${response.status})`);
    },
  };
}
