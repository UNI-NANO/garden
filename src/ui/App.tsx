import { Component, type ComponentChildren } from "preact";
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

export function App(props: { fb: Firebase; limits: Limits }) {
  const [session, setSession] = useState<Session>({ status: "loading" });
  useEffect(() => watchSession(props.fb, props.limits, setSession), [props.fb, props.limits]);

  return (
    <ErrorBoundary fb={props.fb}>
      {session.status === "loading" ? (
        <Notice title="저편의 정원">문을 여는 중…</Notice>
      ) : session.status === "signedOut" ? (
        <LoginScreen fb={props.fb} />
      ) : (
        <LibraryHome fb={props.fb} session={session} />
      )}
    </ErrorBoundary>
  );
}
