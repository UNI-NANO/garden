import type { ComponentChildren } from "preact";

/** 찢어진 원고지 종이 */
export function Paper(props: { class?: string; children: ComponentChildren; label?: string }) {
  return (
    <section class={`paper ${props.class ?? ""}`} aria-label={props.label}>
      {props.children}
    </section>
  );
}

/** 화면 가운데 안내 종이 (오류, 기다림) */
export function Notice(props: { title: string; children: ComponentChildren }) {
  return (
    <main class="stage stage--center">
      <Paper class="notice" label={props.title}>
        <h1 class="notice__title">{props.title}</h1>
        <p class="notice__body">{props.children}</p>
      </Paper>
    </main>
  );
}
