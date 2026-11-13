import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut as firebaseSignOut, type User } from "firebase/auth";
import { get, onValue, push, ref, set, update } from "firebase/database";
import { AccountSchema, ErrorRecordSchema, type Account } from "../schema/account";
import { characterSchema, type Character } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import type { Firebase } from "./firebase-app";
import { paths } from "./paths";

/** 화면이 그릴 상태 */
export type Session =
  | { status: "loading" }
  | { status: "signedOut" }
  | {
      status: "signedIn";
      uid: string;
      displayName: string;
      isGm: boolean;
      /** 연결된 캐릭터. 없으면 아직 사서가 열람증을 준비하는 중 */
      character: Character | undefined;
      /** 저장된 값을 읽지 못했을 때의 안내 (화면은 멈추지 않는다) */
      problem: string | undefined;
    };

/**
 * 로그인 상태 → 계정 기록 → 연결된 캐릭터를 따라가며 상태를 알려준다.
 * 읽은 값은 스키마를 통과해야만 화면에 넘긴다.
 */
export function watchSession(fb: Firebase, limits: Limits, onChange: (session: Session) => void): () => void {
  const schema = characterSchema(limits);
  let stopAccount: (() => void) | undefined;
  let stopCharacter: (() => void) | undefined;
  const stopWatching = () => {
    stopAccount?.();
    stopCharacter?.();
    stopAccount = stopCharacter = undefined;
  };

  const stopAuth = onAuthStateChanged(fb.auth, (user) => {
    stopWatching();
    if (user === null) {
      onChange({ status: "signedOut" });
      return;
    }
    onChange({ status: "loading" });
    void follow(user);
  });

  const follow = async (user: User) => {
    const base = { status: "signedIn" as const, uid: user.uid, displayName: user.displayName ?? "", isGm: false };
    try {
      await touchAccount(fb, user);
      base.isGm = (await get(ref(fb.db, paths.gm(user.uid)))).val() === true;
    } catch (error) {
      reportError(fb, error, "계정 기록");
      onChange({ ...base, character: undefined, problem: "계정 기록을 읽지 못했어요. 잠시 뒤 다시 열어 주세요." });
      return;
    }

    stopAccount = onValue(
      ref(fb.db, paths.account(user.uid)),
      (snapshot) => {
        stopCharacter?.();
        stopCharacter = undefined;
        const account = AccountSchema.safeParse(snapshot.val());
        if (!account.success) {
          reportError(fb, new Error(`계정 기록이 스키마와 다르다: ${account.error.issues[0]?.message ?? ""}`), "계정 기록");
          onChange({ ...base, character: undefined, problem: "계정 기록에 문제가 있어요. GM에게 알려 주세요." });
          return;
        }
        const characterId = account.data.characterId;
        if (characterId === undefined) {
          onChange({ ...base, character: undefined, problem: undefined });
          return;
        }
        stopCharacter = onValue(
          ref(fb.db, paths.character(characterId)),
          (characterSnapshot) => {
            const character = schema.safeParse(characterSnapshot.val());
            if (character.success) {
              onChange({ ...base, character: character.data, problem: undefined });
            } else {
              const issue = character.error.issues[0];
              reportError(fb, new Error(`캐릭터 ${characterId}가 스키마와 다르다: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`), "캐릭터 읽기");
              onChange({ ...base, character: undefined, problem: "캐릭터 기록을 읽지 못했어요. GM에게 알려 주세요." });
            }
          },
          (error) => {
            reportError(fb, error, "캐릭터 읽기");
            onChange({ ...base, character: undefined, problem: "캐릭터 기록을 읽지 못했어요. 잠시 뒤 다시 열어 주세요." });
          },
        );
      },
      (error) => {
        reportError(fb, error, "계정 기록");
        onChange({ ...base, character: undefined, problem: "계정 기록을 읽지 못했어요. 잠시 뒤 다시 열어 주세요." });
      },
    );
  };

  return () => {
    stopAuth();
    stopWatching();
  };
}

/** 계정 기록이 없으면 만들고, 있으면 마지막으로 들어온 때만 고친다 */
async function touchAccount(fb: Firebase, user: User): Promise<void> {
  const now = Date.now();
  const existing = (await get(ref(fb.db, `${paths.account(user.uid)}/createdAt`))).val() as unknown;
  const fields: Partial<Account> = { displayName: (user.displayName ?? "").slice(0, 80), lastSeenAt: now };
  if (existing === null) fields.createdAt = now;
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) updates[`${paths.account(user.uid)}/${key}`] = value;
  await update(ref(fb.db), updates);
}

export async function signInWithGoogle(fb: Firebase): Promise<void> {
  await signInWithPopup(fb.auth, new GoogleAuthProvider());
}

/**
 * 시험 계정으로 들어간다. 에뮬레이터에서만 된다(에뮬레이터는 서명 없는 가짜 구글 토큰을 받는다).
 * 실제 환경 빌드에는 이 함수를 부르는 버튼이 들어가지 않는다.
 */
export async function signInTestAccount(fb: Firebase, name: string): Promise<void> {
  if (fb.env.name !== "emulator") throw new Error("시험 계정은 에뮬레이터에서만 쓸 수 있다");
  const slug = [...name].map((ch) => ch.codePointAt(0)?.toString(16) ?? "").join("");
  const token = JSON.stringify({ sub: `test-${slug}`, email: `test-${slug}@example.test`, email_verified: true, name });
  await signInWithCredential(fb.auth, GoogleAuthProvider.credential(token));
}

export async function signOut(fb: Firebase): Promise<void> {
  await firebaseSignOut(fb.auth);
}

/**
 * 화면에서 난 오류를 기록한다(GM 패널에서 본다). 기록에 실패해도 화면을 멈추지 않는다.
 */
export function reportError(fb: Firebase | undefined, error: unknown, where: string): void {
  console.error(`[${where}]`, error);
  const uid = fb?.auth.currentUser?.uid;
  if (fb === undefined || uid === undefined) return;
  const record = ErrorRecordSchema.safeParse({
    at: Date.now(),
    uid,
    message: (error instanceof Error ? error.message : String(error)).slice(0, 2000) || "알 수 없는 오류",
    where: where.slice(0, 200),
    ...(error instanceof Error && error.stack ? { detail: error.stack.slice(0, 4000) } : {}),
  });
  if (!record.success) return;
  void set(push(ref(fb.db, "errors")), record.data).catch(() => undefined);
}
