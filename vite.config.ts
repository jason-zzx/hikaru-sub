import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const JASSUB_DEFAULT_FONT_URL = "new URL('./default.woff2', import.meta.url)";
const JASSUB_DEFAULT_FONT_URL_IGNORED =
  "new URL(/* @vite-ignore */ './default.woff2', import.meta.url)";

export function viteIgnoreMissingJassubDefaultFont(): Plugin {
  return {
    name: "vite-ignore-missing-jassub-default-font",
    enforce: "pre",
    transform(code, id) {
      if (
        !id.includes("node_modules") ||
        !id.includes("jassub") ||
        !code.includes(JASSUB_DEFAULT_FONT_URL)
      ) {
        return null;
      }

      return code.replaceAll(
        JASSUB_DEFAULT_FONT_URL,
        JASSUB_DEFAULT_FONT_URL_IGNORED,
      );
    },
  };
}

export const testExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
  ".trellis/**",
  "native-asr/build/**",
];

export default defineConfig(async () => ({
  plugins: [viteIgnoreMissingJassubDefaultFont(), react(), tailwindcss()],

  worker: {
    format: "es",
  },

  optimizeDeps: {
    include: ["jassub"],
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  test: {
    exclude: testExclude,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Rust 后端由 cargo watch 处理；Python venv 文件极多，会耗尽 inotify 配额
      ignored: ["**/src-tauri/**", "**/.venv/**", "**/venv/**"],
    },
  },
}));
