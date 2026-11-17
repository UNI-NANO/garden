import { Component, h, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Firebase } from "../data/firebase-app";
import { reportError, watchSession, type Session } from "../data/session";
import type { Limits } from "../schema/defs/limits";
import { LibraryHome } from "./LibraryHome";
import { LoginScreen } from "./LoginScreen";
import { Notice } from "./parts";

/** 화면을 그리다 난 오류를 잡는다. 하얗게 되지 않고 안내를 띄우며, 오류를 기록한다. */
class ErrorBoundary extends Component<{ fb: Firebase; children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };

  static override getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    reportError(this.props.fb, error, "화면 그리기");
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice title="책장이 잠시 흐트러졌어요">
        화면을 그리다 문제가 생겼어요. 기록해 두었으니, 새로 고쳐 다시 열어 주세요.
        <br />
        <button class="button" type="button" onClick={() => window.location.reload()}>
          새로 고치기
        </button>
      </Notice>
    );
  }
}

/** 연습 전투는 시험 환경에만. 실제 환경 빌드에서는 이 갈래가 통째로 빠진다(`npm run check:build`가 확인) */
const PRACTICE = import.meta.env.VITE_GARDEN_ENV !== "prod";
type PracticeScreen = (props: { fb: Firebase; onExit: () => void }) => preact.JSX.Element;

export function App(props: { fb: Firebase; limits: Limits }) {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [practice, setPractice] = useState<PracticeScreen | "loading">();
  useEffect(() => watchSession(props.fb, props.limits, setSession), [props.fb, props.limits]);
  // 시험 환경에서는 주소 끝에 #practice를 붙이면 로그인 없이 연습장이 바로 열린다 (숫자를 직접 쳐 보는 용도)
  useEffect(() => {
    if (PRACTICE && window.location.hash === "#practice") openPractice();
  }, []);

  const openPractice = () => {
    if (!PRACTICE) return;
    setPractice("loading");
    import("./battle/Practice")
      .then((module) => setPractice(() => module.Practice))
      .catch((error: unknown) => {
        reportError(props.fb, error, "연습 전투 열기");
        setPractice(undefined);
      });
  };

  const closePractice = () => {
    setPractice(undefined);
    if (window.location.hash === "#practice") history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  return (
    <ErrorBoundary fb={props.fb}>
      {PRACTICE && practice === "loading" ? (
        <Notice title="연습 전투">연습장을 여는 중…</Notice>
      ) : PRACTICE && practice ? (
        h(practice, { fb: props.fb, onExit: closePractice })
      ) : session.status === "loading" ? (
        <Notice title="저편의 정원">문을 여는 중…</Notice>
      ) : session.status === "signedOut" ? (
        <LoginScreen fb={props.fb} />
      ) : (
        <LibraryHome fb={props.fb} session={session} {...(PRACTICE ? { onPractice: openPractice } : {})} />
      )}
    </ErrorBoundary>
  );
}
