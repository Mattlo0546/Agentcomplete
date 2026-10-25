import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, rm } from "node:fs/promises";
const here = dirname(fileURLToPath(import.meta.url)),
  front = resolve(here, ".."),
  out = resolve(front, "../plugin/chrome-extension");
const require = createRequire(resolve(front, "package.json"));
const vitePath = require.resolve("vite", { paths: [dirname(require.resolve("vitest/package.json"))] });
const tailwindBase = dirname(require.resolve("@tailwindcss/turbopack"));
const { compile } = await import(pathToFileURL(require.resolve("@tailwindcss/node", { paths: [tailwindBase] })).href);
const { Scanner } = await import(pathToFileURL(require.resolve("@tailwindcss/oxide", { paths: [tailwindBase] })).href);
const scan = new Scanner({
  sources: [
    { base: resolve(front, "src"), pattern: "**/*.{ts,tsx}", negated: false },
    { base: here, pattern: "**/*.{ts,tsx}", negated: false },
  ],
});
const source =
  (await readFile(resolve(front, "src/app/globals.css"), "utf8")) +
  "\n" +
  (await readFile(require.resolve("sonner/dist/styles.css"), "utf8")) +
  "\n" +
  (await readFile(resolve(here, "chatgpt-theme.css"), "utf8"));
const compiler = await compile(source, { base: resolve(front, "src/app"), onDependency() {} });
await writeFile(resolve(here, "generated.css"), compiler.build(scan.scan()));
const aliases = [
  ["@/lib/api/client", "api-client.ts"],
  ["./use-layout-mode", "use-layout-mode.ts"],
  ["@/components/shell/use-layout-mode", "use-layout-mode.ts"],
  ["./use-send-to-codex", "send-to-chatgpt.ts"],
  ["./editor-footer", "editor-footer.tsx"],
  ["./backend-group", "backend-group.tsx"],
  ["next/link", "navigation.tsx"],
  ["next/navigation", "navigation.tsx"],
  ["next-themes", "theme.tsx"],
].map(([find, file]) => ({ find, replacement: resolve(here, file) }));
aliases.push({ find: /^react-dom$/, replacement: resolve(here, "react-dom.ts") });
aliases.push({ find: "pe-react-dom", replacement: require.resolve("react-dom") });
aliases.push({ find: /^@mantine\/hooks$/, replacement: resolve(here, "storage.ts") });
aliases.push({ find: "pe-mantine-hooks", replacement: require.resolve("@mantine/hooks") });
const dialogPath = require.resolve("@radix-ui/react-dialog", { paths: [dirname(require.resolve("radix-ui"))] });
aliases.push({ find: /^aria-hidden$/, replacement: resolve(here, "aria-hidden.ts") });
aliases.push({ find: "pe-aria-hidden", replacement: require.resolve("aria-hidden", { paths: [dirname(dialogPath)] }) });
aliases.push({ find: "@", replacement: resolve(front, "src") });
const { build } = await import(pathToFileURL(vitePath).href);
await build({
  configFile: false,
  root: front,
  publicDir: false,
  resolve: { alias: aliases },
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": "undefined" },
  build: {
    outDir: resolve(out, "dist"),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
    lib: {
      entry: resolve(here, "workspace-host.tsx"),
      name: "PromptEnhanceWorkspace",
      formats: ["iife"],
      fileName: () => "workspace-host.js",
    },
  },
});
await rm(resolve(out, "workspace.html"), { force: true });
await rm(resolve(out, "__pycache__"), { recursive: true, force: true });
await rm(resolve(out, "tests/__pycache__"), { recursive: true, force: true });
console.log("Extension host workspace built from shared frontend components.");
