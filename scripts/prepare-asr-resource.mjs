import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "asr-service");
const target = join(root, "src-tauri", "resources", "asr-service");

const ignoredNames = new Set([
  ".cache",
  ".gitignore",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "model-cache",
  "models",
  "tests",
  "venv",
]);

function shouldCopy(src) {
  const rel = relative(source, src);
  if (!rel) return true;
  const parts = rel.split(/[\\/]+/);
  if (parts.some((part) => ignoredNames.has(part))) return false;
  if (parts.some((part) => part.endsWith(".egg-info"))) return false;
  if (parts.some((part) => part.endsWith(".log"))) return false;
  return true;
}

if (!existsSync(join(source, "main.py"))) {
  throw new Error(`missing asr-service template: ${source}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(source, target, {
  recursive: true,
  filter(src) {
    if (!shouldCopy(src)) return false;
    const stats = statSync(src);
    return stats.isDirectory() || stats.isFile();
  },
});

console.log(`prepared ASR resource: ${target}`);
