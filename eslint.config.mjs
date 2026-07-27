import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/dist/**",
    "**/generated/**",
    "**/node_modules/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...eslint.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["apps/api/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
  })),
  ...nextTypeScript.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
  })),
]);
