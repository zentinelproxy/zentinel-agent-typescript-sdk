// ESLint flat config: typescript-eslint's recommended rules over the SDK's
// sources, tests and examples.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "build/", "node_modules/", "docs/"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused parameters are part of the handler signatures agents override;
      // prefix them with `_` to say so.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  }
);
