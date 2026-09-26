// Vite-style `?raw` imports: a module path suffixed with `?raw` resolves to
// its file contents as a string. Used by ai/prompts.ts to inline the markdown
// prompt templates at build time.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
