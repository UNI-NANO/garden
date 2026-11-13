import { EnvConfigSchema, EnvNameSchema, type EnvConfig, type EnvName } from "../schema/env";

/**
 * 환경 셋.
 * - emulator: 로컬 Firebase 에뮬레이터. 개발과 자동 테스트는 여기서만 돈다.
 * - staging: 시험용 Firebase 프로젝트. 아직 만들지 않아 값이 비어 있다. (비어 있는 동안은 고르면 실패한다)
 * - prod: 실제 프로젝트.
 *
 * 여기 적힌 값은 브라우저에 그대로 보이는 공개 설정이다. 비밀 키는 여기 두지 않는다.
 */
const ENVS: Record<EnvName, unknown> = {
  emulator: {
    name: "emulator",
    firebase: {
      apiKey: "demo-key",
      authDomain: "demo-garden.firebaseapp.com",
      databaseURL: "http://127.0.0.1:9000?ns=demo-garden-default-rtdb",
      projectId: "demo-garden",
      storageBucket: "demo-garden.appspot.com",
      messagingSenderId: "0",
      appId: "demo-app",
    },
    emulator: { host: "127.0.0.1", databasePort: 9000, authPort: 9099 },
  },
  staging: {
    name: "staging",
    firebase: {
      apiKey: "",
      authDomain: "",
      databaseURL: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
    },
  },
  prod: {
    name: "prod",
    firebase: {
      apiKey: "AIzaSyB2mpcP6r6MxW_l2iNnB7qWam0iD-2OaF8",
      authDomain: "hortus-qui-est-ultra.firebaseapp.com",
      databaseURL: "https://hortus-qui-est-ultra-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "hortus-qui-est-ultra",
      storageBucket: "hortus-qui-est-ultra.firebasestorage.app",
      messagingSenderId: "1076528598838",
      appId: "1:1076528598838:web:91ac3cce222e1c580b6d97",
    },
  },
};

export class EnvError extends Error {
  override name = "EnvError";
}

/**
 * 환경 하나를 골라 검사해서 돌려준다.
 * @param requested 환경 이름. 없으면 가장 안전한 emulator.
 * @param options.isTest 자동 테스트 중인지. 테스트 중에는 emulator만 허용한다.
 */
export function selectEnv(requested: string | undefined, options: { isTest: boolean }): EnvConfig {
  const parsedName = EnvNameSchema.safeParse(requested ?? "emulator");
  if (!parsedName.success) {
    throw new EnvError(`모르는 환경 이름: "${requested}" (emulator / staging / prod 중 하나)`);
  }
  const name = parsedName.data;

  if (options.isTest && name !== "emulator") {
    throw new EnvError(`자동 테스트는 emulator 환경에서만 돈다 ("${name}" 거부)`);
  }

  const parsed = EnvConfigSchema.safeParse(ENVS[name]);
  if (!parsed.success) {
    throw new EnvError(`"${name}" 환경 설정이 비었거나 모양이 틀리다: ${parsed.error.issues[0]?.message ?? ""}`);
  }
  if (parsed.data.name !== name) {
    throw new EnvError(`"${name}" 자리에 "${parsed.data.name}" 설정이 들어 있다`);
  }
  return parsed.data;
}
