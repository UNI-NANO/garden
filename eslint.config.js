import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "docs/"] },
  ...tseslint.configs.recommended,
  {
    // 게임 규칙은 순수 함수다. 화면·저장·Firebase를 끌어오지 못하게 막는다.
    files: ["src/rules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase", "firebase/*", "firebase-admin", "firebase-admin/*"],
              message: "규칙 코드는 Firebase를 쓰지 않는다.",
            },
            {
              group: ["**/data/**", "**/ui/**", "**/data", "**/ui"],
              message: "규칙 코드는 저장·화면 코드를 끌어오지 않는다.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "규칙 코드는 화면에 기대지 않는다." },
        { name: "document", message: "규칙 코드는 화면에 기대지 않는다." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "씨앗 난수(rng.ts)를 쓴다." },
        { object: "Date", property: "now", message: "시각은 인자로 받는다." },
      ],
    },
  },
);
