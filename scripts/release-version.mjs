const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "(?:\\d*[A-Za-z-][0-9A-Za-z-]*)";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const VERSION_RE = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}` +
    `(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?$`,
);

export function validateReleaseVersion(version) {
  if (typeof version !== "string" || !VERSION_RE.test(version)) {
    throw new Error(
      `invalid version "${version ?? ""}"; expected MAJOR.MINOR.PATCH with an optional prerelease suffix`,
    );
  }
  return version;
}

export function versionFromReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error(
      `invalid release tag "${tag ?? ""}"; expected vMAJOR.MINOR.PATCH`,
    );
  }
  return validateReleaseVersion(tag.slice(1));
}
