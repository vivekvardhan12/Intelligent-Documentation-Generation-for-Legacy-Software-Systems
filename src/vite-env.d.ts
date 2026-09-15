/// <reference types="vite/client" />

/**
 * Typed build-time environment variables.
 *
 * Vite only exposes variables prefixed with `VITE_` to client code, which is a
 * safety feature: it makes it impossible to leak a server secret (such as
 * GEMINI_API_KEY) into the browser bundle by accident. Declaring them here
 * means a typo in `import.meta.env.VITE_...` is a compile error rather than a
 * silent `undefined`.
 */
interface ImportMetaEnv {
  /**
   * Optional override for the USD-to-INR rate used by the cost estimator.
   * Example: `VITE_USD_TO_INR=88.5 npm run build`.
   */
  readonly VITE_USD_TO_INR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
