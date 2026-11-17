import { onValue, ref } from "firebase/database";
import { WORLD_CLOCK_PATH, WorldClockSchema, type WorldClock } from "../schema/world";
import type { Firebase } from "./firebase-app";
import { reportError } from "./session";

/** 세계 시계를 지켜본다. 없거나 모양이 틀리면 undefined (화면은 멈추지 않는다) */
export function watchWorldClock(fb: Firebase, onChange: (clock: WorldClock | undefined) => void): () => void {
  return onValue(
    ref(fb.db, WORLD_CLOCK_PATH),
    (snapshot) => {
      if (!snapshot.exists()) return onChange(undefined);
      const clock = WorldClockSchema.safeParse(snapshot.val());
      if (!clock.success) reportError(fb, new Error(`세계 시계가 스키마와 다르다: ${clock.error.issues[0]?.message ?? ""}`), "세계 시계 읽기");
      onChange(clock.success ? clock.data : undefined);
    },
    (error) => {
      // 나가는 순간 읽기 권한이 먼저 사라지는 것은 오류가 아니다
      if (fb.auth.currentUser !== null) reportError(fb, error, "세계 시계 읽기");
      onChange(undefined);
    },
  );
}
