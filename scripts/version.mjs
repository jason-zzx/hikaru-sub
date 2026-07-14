import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateReleaseVersion,
  versionFromReleaseTag,
} from "./release-version.mjs";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const TAURI_VERSION_SOURCE = "../package.json";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTomlSection(text, sectionName) {
  const marker = new RegExp(`^\\[${escapeRegExp(sectionName)}\\]\\s*$`, "m");
  const match = marker.exec(text);
  if (!match) {
    throw new Error(`missing [${sectionName}] section`);
  }

  const contentStart = match.index + match[0].length;
  const remaining = text.slice(contentStart);
  const nextSectionOffset = remaining.search(/^\[[^\r\n]+\]\s*$/m);
  const end = nextSectionOffset < 0 ? text.length : contentStart + nextSectionOffset;
  return { contentStart, end, text: text.slice(contentStart, end) };
}

function readTomlStringField(section, fieldName) {
  const field = new RegExp(
    `^${escapeRegExp(fieldName)}\\s*=\\s*"([^"]+)"\\s*$`,
    "gm",
  );
  const matches = [...section.text.matchAll(field)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${fieldName} in [package]`);
  }
  return matches[0][1];
}

function replaceTomlStringField(text, sectionName, fieldName, value) {
  const section = findTomlSection(text, sectionName);
  readTomlStringField(section, fieldName);
  const field = new RegExp(
    `^(${escapeRegExp(fieldName)}\\s*=\\s*")[^"]+("\\s*)$`,
    "m",
  );
  const replaced = section.text.replace(
    field,
    (_match, prefix, suffix) => `${prefix}${value}${suffix}`,
  );
  return text.slice(0, section.contentStart) + replaced + text.slice(section.end);
}

function findCargoLockPackage(text, packageName) {
  const starts = [...text.matchAll(/^\[\[package\]\]\s*$/gm)].map(
    (match) => match.index,
  );
  const nameLine = new RegExp(
    `^name\\s*=\\s*"${escapeRegExp(packageName)}"\\s*$`,
    "m",
  );
  const matches = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? text.length;
    const block = text.slice(start, end);
    if (nameLine.test(block)) {
      matches.push({ start, end, text: block });
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${packageName} package in src-tauri/Cargo.lock`,
    );
  }
  return matches[0];
}

function readCargoLockVersion(text, packageName) {
  const block = findCargoLockPackage(text, packageName);
  const version = /^version\s*=\s*"([^"]+)"\s*$/m.exec(block.text);
  if (!version) {
    throw new Error(`missing version for ${packageName} in src-tauri/Cargo.lock`);
  }
  return version[1];
}

function replaceCargoLockVersion(text, packageName, version) {
  const block = findCargoLockPackage(text, packageName);
  readCargoLockVersion(text, packageName);
  const replaced = block.text.replace(
    /^(version\s*=\s*")[^"]+("\s*)$/m,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  return text.slice(0, block.start) + replaced + text.slice(block.end);
}

function projectPaths(root) {
  return {
    packageJson: join(root, "package.json"),
    cargoToml: join(root, "src-tauri", "Cargo.toml"),
    cargoLock: join(root, "src-tauri", "Cargo.lock"),
    tauriConfig: join(root, "src-tauri", "tauri.conf.json"),
  };
}

function replacePackageJsonVersion(text, currentVersion, nextVersion) {
  const property = new RegExp(
    `("version"\\s*:\\s*")${escapeRegExp(currentVersion)}(")`,
    "g",
  );
  const matches = [...text.matchAll(property)];
  if (matches.length !== 1) {
    throw new Error("expected exactly one top-level version in package.json");
  }
  return text.replace(
    property,
    (_match, prefix, suffix) => `${prefix}${nextVersion}${suffix}`,
  );
}

export function readProjectVersions(root = defaultRoot) {
  const paths = projectPaths(root);
  const packageJson = JSON.parse(readFileSync(paths.packageJson, "utf8"));
  const cargoToml = readFileSync(paths.cargoToml, "utf8");
  const cargoLock = readFileSync(paths.cargoLock, "utf8");
  const tauriConfig = JSON.parse(readFileSync(paths.tauriConfig, "utf8"));
  const packageSection = findTomlSection(cargoToml, "package");
  const cargoName = readTomlStringField(packageSection, "name");

  return {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    cargoName,
    cargoVersion: readTomlStringField(packageSection, "version"),
    cargoLockVersion: readCargoLockVersion(cargoLock, cargoName),
    tauriVersionSource: tauriConfig.version,
  };
}

export function checkProjectVersions({ root = defaultRoot, tag } = {}) {
  const versions = readProjectVersions(root);
  const errors = [];

  for (const [label, version] of [
    ["package.json", versions.packageVersion],
    ["src-tauri/Cargo.toml", versions.cargoVersion],
    ["src-tauri/Cargo.lock", versions.cargoLockVersion],
  ]) {
    try {
      validateReleaseVersion(version);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  if (versions.packageName !== versions.cargoName) {
    errors.push(
      `package name mismatch: package.json=${versions.packageName}, Cargo.toml=${versions.cargoName}`,
    );
  }
  if (versions.cargoVersion !== versions.packageVersion) {
    errors.push(
      `version mismatch: package.json=${versions.packageVersion}, Cargo.toml=${versions.cargoVersion}`,
    );
  }
  if (versions.cargoLockVersion !== versions.packageVersion) {
    errors.push(
      `version mismatch: package.json=${versions.packageVersion}, Cargo.lock=${versions.cargoLockVersion}`,
    );
  }
  if (versions.tauriVersionSource !== TAURI_VERSION_SOURCE) {
    errors.push(
      `src-tauri/tauri.conf.json version must be "${TAURI_VERSION_SOURCE}"`,
    );
  }

  if (tag) {
    try {
      const tagVersion = versionFromReleaseTag(tag);
      if (tagVersion !== versions.packageVersion) {
        errors.push(
          `release tag ${tag} does not match package.json version ${versions.packageVersion}`,
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length > 0) {
    throw new Error(`version check failed:\n- ${errors.join("\n- ")}`);
  }
  return versions;
}

export function setProjectVersion(version, root = defaultRoot) {
  validateReleaseVersion(version);
  const paths = projectPaths(root);
  const packageJsonText = readFileSync(paths.packageJson, "utf8");
  const packageJson = JSON.parse(packageJsonText);
  const cargoToml = readFileSync(paths.cargoToml, "utf8");
  const cargoLock = readFileSync(paths.cargoLock, "utf8");
  const tauriConfig = JSON.parse(readFileSync(paths.tauriConfig, "utf8"));
  const packageSection = findTomlSection(cargoToml, "package");
  const cargoName = readTomlStringField(packageSection, "name");

  if (packageJson.name !== cargoName) {
    throw new Error(
      `package name mismatch: package.json=${packageJson.name}, Cargo.toml=${cargoName}`,
    );
  }
  if (tauriConfig.version !== TAURI_VERSION_SOURCE) {
    throw new Error(
      `src-tauri/tauri.conf.json version must be "${TAURI_VERSION_SOURCE}"`,
    );
  }

  const nextPackageJson = replacePackageJsonVersion(
    packageJsonText,
    packageJson.version,
    version,
  );
  const nextCargoToml = replaceTomlStringField(
    cargoToml,
    "package",
    "version",
    version,
  );
  const nextCargoLock = replaceCargoLockVersion(
    cargoLock,
    cargoName,
    version,
  );

  writeFileSync(paths.packageJson, nextPackageJson);
  writeFileSync(paths.cargoToml, nextCargoToml);
  writeFileSync(paths.cargoLock, nextCargoLock);

  return checkProjectVersions({ root });
}

function printUsage() {
  console.error(
    "Usage: node scripts/version.mjs set <version> | check [v<version>]",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, value, ...rest] = process.argv.slice(2);
    if (rest.length > 0 || (command !== "set" && command !== "check")) {
      printUsage();
      process.exitCode = 1;
    } else if (command === "set") {
      if (!value) {
        printUsage();
        process.exitCode = 1;
      } else {
        const versions = setProjectVersion(value);
        console.log(`set Hikaru Sub version to ${versions.packageVersion}`);
      }
    } else {
      const tag = value ?? process.env.RELEASE_TAG;
      const versions = checkProjectVersions({ tag });
      console.log(`version ${versions.packageVersion} is consistent`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
