import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import noBarrelFilesPlugin from "eslint-plugin-no-barrel-files";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{js,ts,jsx,tsx}"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "no-barrel-files": noBarrelFilesPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "no-barrel-files/no-barrel-files": [
        "error",
        {
          allow: [
            "**/index.ts",
            "**/index.tsx",
            "**/Combobox.tsx",
            "**/Listbox.tsx",
            "**/Popover.tsx",
          ],
        },
      ],
    },
  },
];
