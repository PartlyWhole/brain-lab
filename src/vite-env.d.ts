/// <reference types="vite/client" />

declare const __APP_BUILD__: { commit: string; builtAt: string }

declare module '*.py?raw' {
  const content: string
  export default content
}
