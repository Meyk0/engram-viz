import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "packages/*/dist/**",
      "playwright-report/**",
      "test-results/**"
    ]
  }
];

export default eslintConfig;
