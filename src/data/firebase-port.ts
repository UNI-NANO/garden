import { get, ref, update, type Database } from "firebase/database";
import type { DbPort } from "./commit";

/** 실제 Firebase(또는 에뮬레이터)에 닿는 창구. 보안 규칙이 막으면 "denied". */
export function firebasePort(db: Database): DbPort {
  return {
    get: async (path) => (await get(ref(db, path))).val() as unknown,
    update: async (updates) => {
      try {
        await update(ref(db), updates);
        return "ok";
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        const message = error instanceof Error ? error.message : "";
        if (`${code} ${message}`.toUpperCase().includes("PERMISSION_DENIED")) return "denied";
        throw error;
      }
    },
  };
}
