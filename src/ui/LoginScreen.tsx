import { useState } from "preact/hooks";
import type { Firebase } from "../data/firebase-app";
import { reportError, signInTestAccount, signInWithGoogle } from "../data/session";
import { Paper } from "./parts";

// 시험 계정 버튼은 에뮬레이터용 빌드에만 들어간다. 실제 환경 빌드에서는 이 값이 false로 굳어 코드째 빠진다.
const TEST_LOGIN = import.meta.env.DEV || import.meta.env.VITE_GARDEN_ENV === "emulator";

export function LoginScreen(props: { fb: Firebase }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [testName, setTestName] = useState("시험 계정");

  const enter = async (signIn: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await signIn();
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      // 창을 그냥 닫은 것은 오류가 아니다
      if (!code.includes("popup-closed") && !code.includes("cancelled-popup")) {
        reportError(props.fb, error, "로그인");
        setMessage("들어가지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="stage login">
      <header class="login__title">
        <h1>저편의 정원</h1>
        <p>세계수 도서관</p>
      </header>
      <svg class="login__door" aria-hidden="true" viewBox="0 0 260 300">
        <path d="M30 300 V120 Q130 10 230 120 V300" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M60 300 V135 Q130 50 200 135 V300" class="login__door-glow" stroke="currentColor" stroke-width="1.2" />
        <path d="M130 300 V80" stroke="currentColor" stroke-width="1" />
        <circle cx="118" cy="210" r="3" class="login__door-knob" />
        <circle cx="142" cy="210" r="3" class="login__door-knob" />
      </svg>
      <Paper class="login__paper" label="도서관 입구">
        <h2 class="paper__heading">도서관 입구</h2>
        <button class="button button--main" type="button" disabled={busy} onClick={() => void enter(() => signInWithGoogle(props.fb))}>
          구글 계정으로 들어가기
        </button>
        <p class="login__hint">처음이면 문을 여는 순간 이방인이 됩니다</p>
        {message !== undefined && (
          <p class="login__message" role="alert">
            {message}
          </p>
        )}
        {TEST_LOGIN && props.fb.env.name === "emulator" && (
          <form
            class="login__test"
            onSubmit={(event) => {
              event.preventDefault();
              void enter(() => signInTestAccount(props.fb, testName.trim() || "시험 계정"));
            }}
          >
            <label>
              <span>시험 환경</span>
              <input value={testName} maxLength={20} onInput={(event) => setTestName(event.currentTarget.value)} aria-label="시험 계정 이름" />
            </label>
            <button class="button" type="submit" disabled={busy}>
              시험 계정으로 들어가기
            </button>
          </form>
        )}
      </Paper>
    </main>
  );
}
