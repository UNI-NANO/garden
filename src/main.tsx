import { render } from "preact";
import rawLimits from "../data/defs/limits.json";
import { selectEnv } from "./data/env";
import { openFirebase, type Firebase } from "./data/firebase-app";
import { reportError } from "./data/session";
import { LimitsSchema } from "./schema/defs/limits";
import { App } from "./ui/App";
import { Notice } from "./ui/parts";
import "./ui/styles.css";

const root = document.getElementById("app");
if (root) {
  let fb: Firebase | undefined;
  try {
    const env = selectEnv(import.meta.env.VITE_GARDEN_ENV, { isTest: import.meta.env.MODE === "test" });
    fb = openFirebase(env);
    // 화면 밖에서 난 오류도 기록한다. 화면은 멈추지 않는다.
    window.addEventListener("error", (event) => reportError(fb, event.error ?? event.message, "화면"));
    window.addEventListener("unhandledrejection", (event) => reportError(fb, event.reason, "화면"));
    render(<App fb={fb} limits={LimitsSchema.parse(rawLimits)} />, root);
  } catch (error) {
    reportError(fb, error, "시작");
    render(<Notice title="문을 열지 못했어요">설정을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.</Notice>, root);
  }
}
