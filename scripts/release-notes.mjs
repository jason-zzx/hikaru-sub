import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionFromReleaseTag } from "./release-version.mjs";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReleaseNotes(changelog, tag) {
  const version = versionFromReleaseTag(tag);
  const versionHeading = new RegExp(
    `^## \\[${escapeRegExp(version)}\\].*\\r?$`,
    "gm",
  );
  const matches = [...changelog.matchAll(versionHeading)];

  if (matches.length === 0) {
    throw new Error(
      `CHANGELOG.md is missing "## [${version}] - YYYY-MM-DD"`,
    );
  }
  if (matches.length > 1) {
    throw new Error(`CHANGELOG.md contains duplicate ${version} entries`);
  }
  const exactHeading = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`,
  );
  if (!exactHeading.test(matches[0][0])) {
    throw new Error(
      `CHANGELOG.md entry ${version} must use "## [${version}] - YYYY-MM-DD" exactly`,
    );
  }

  const start = matches[0].index + matches[0][0].length;
  const remaining = changelog.slice(start);
  const nextHeading = remaining.search(/^##\s+/m);
  const notes = (nextHeading < 0 ? remaining : remaining.slice(0, nextHeading)).trim();

  if (!notes) {
    throw new Error(`CHANGELOG.md entry ${version} has no release notes`);
  }
  return notes;
}

export function readReleaseNotes({ root = defaultRoot, tag }) {
  return extractReleaseNotes(
    readFileSync(join(root, "CHANGELOG.md"), "utf8"),
    tag,
  );
}

export function writeGitHubOutput(name, value, outputPath) {
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not available");
  }
  const delimiter = `HIKARU_SUB_${randomUUID().replaceAll("-", "")}`;
  appendFileSync(
    outputPath,
    `${name}<<${delimiter}\n${value.trimEnd()}\n${delimiter}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const githubOutput = args.includes("--github-output");
    const positional = args.filter((arg) => arg !== "--github-output");
    if (positional.length > 1) {
      throw new Error(
        "Usage: node scripts/release-notes.mjs [v<version>] [--github-output]",
      );
    }

    const tag = positional[0] ?? process.env.RELEASE_TAG;
    if (!tag) {
      throw new Error("release tag is required");
    }
    const notes = readReleaseNotes({ tag });

    if (githubOutput) {
      writeGitHubOutput("body", notes, process.env.GITHUB_OUTPUT);
      console.log(`extracted release notes for ${tag}`);
    } else {
      console.log(notes);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
