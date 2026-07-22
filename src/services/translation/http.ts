const MAX_PROVIDER_ERROR_LENGTH = 300;
const MAX_GENERATION_ERROR_LENGTH = 180;
const MIN_CREDENTIAL_OVERLAP_LENGTH = 4;
const MIN_REQUEST_CONTENT_OVERLAP_LENGTH = 8;
const REDACTION_MASK = "***";
export const DEFAULT_MODEL_LIST_TIMEOUT = 30_000;

interface GenerationSensitiveValues {
  credentials: Array<string | undefined>;
  requestContent: Array<string | undefined>;
}

export function buildProviderUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const childPath = path.replace(/^\/+/, "");
  url.pathname = `${basePath}/${childPath}`;
  return url;
}

export async function fetchWithTimeout(
  input: URL,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new GenerationError("timeout");
    throw new GenerationError("network");
  }
}

export class GenerationError extends Error {
  constructor(
    readonly kind: "http" | "response" | "network" | "timeout",
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(
      kind === "http"
        ? `API 错误 ${status}${reason ? `: ${reason}` : ""}`
        : kind === "response"
          ? "响应格式无效"
          : kind === "timeout"
            ? "请求超时"
            : "网络请求失败",
    );
  }
}

export async function generationHttpError(
  response: Response,
  sensitiveValues: GenerationSensitiveValues,
): Promise<GenerationError> {
  const reason = await readStructuredErrorReason(response);
  return new GenerationError(
    "http",
    response.status,
    sanitizeGenerationReason(reason, sensitiveValues),
  );
}

async function readStructuredErrorReason(response: Response): Promise<string> {
  try {
    const parsed = JSON.parse(await response.text()) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const candidate =
      typeof parsed.error === "object" && parsed.error
        ? parsed.error.message
        : typeof parsed.error === "string"
          ? parsed.error
          : parsed.message;
    return typeof candidate === "string" ? candidate : "";
  } catch {
    return "";
  }
}

function collectSensitiveFragments(
  sensitiveValues: Array<string | undefined>,
): string[] {
  const fragments = new Set<string>();
  const add = (value: string, includeShort = false) => {
    const normalized = value.trim();
    if (
      normalized &&
      (includeShort || normalized.length >= MIN_REQUEST_CONTENT_OVERLAP_LENGTH)
    ) {
      fragments.add(normalized);
    }
  };
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      add(value);
      for (const line of value.split(/\r?\n/)) {
        add(line, true);
        for (const glossaryPart of line.split(/\s*(?:->|→)\s*/)) {
          add(glossaryPart.replace(/^\s*-\s*/, ""), true);
        }
      }
      for (const match of value.matchAll(/"(?:\\.|[^"\\])*"/g)) {
        try {
          const decoded: unknown = JSON.parse(match[0]);
          if (typeof decoded === "string") add(decoded, true);
        } catch {
          // Ignore incomplete JSON string fragments.
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };

  for (const value of sensitiveValues) {
    if (!value) continue;
    add(value, true);
    try {
      visit(JSON.parse(value));
    } catch {
      visit(value);
    }
  }
  return [...fragments].sort((a, b) => b.length - a.length);
}

function redactExactIgnoreCase(value: string, sensitive: string): string {
  if (!sensitive) return value;
  const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "giu"), REDACTION_MASK);
}

function sanitizeGenerationReason(
  reason: string,
  sensitiveValues: GenerationSensitiveValues,
): string | undefined {
  if (reason.length > MAX_GENERATION_ERROR_LENGTH * 4) return undefined;
  let sanitized = reason.replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) return undefined;

  const credentialFragments = collectSensitiveFragments(
    sensitiveValues.credentials,
  );
  const requestContentFragments = collectSensitiveFragments(
    sensitiveValues.requestContent,
  );
  for (const fragment of [
    ...credentialFragments,
    ...requestContentFragments,
  ]) {
    sanitized = redactExactIgnoreCase(sanitized, fragment);
  }
  sanitized = sanitized.replace(/\*{3}(?:\s*\*{3})+/g, REDACTION_MASK);

  const normalized = sanitized.toLocaleLowerCase();
  const hasSensitiveOverlap = (fragments: string[], minimumLength: number) =>
    fragments.some((fragment) => {
      if (fragment.length < minimumLength) return false;
      const source = fragment.toLocaleLowerCase();
      for (
        let index = 0;
        index <= normalized.length - minimumLength;
        index += 1
      ) {
        if (source.includes(normalized.slice(index, index + minimumLength))) {
          return true;
        }
      }
      return false;
    });
  if (
    hasSensitiveOverlap(
      credentialFragments,
      MIN_CREDENTIAL_OVERLAP_LENGTH,
    ) ||
    hasSensitiveOverlap(
      requestContentFragments,
      MIN_REQUEST_CONTENT_OVERLAP_LENGTH,
    )
  ) {
    return undefined;
  }

  const bounded = sanitized.slice(0, MAX_GENERATION_ERROR_LENGTH).trim();
  return bounded || undefined;
}

export async function providerHttpError(
  response: Response,
  sensitiveValues: Array<string | undefined> = [],
): Promise<Error> {
  const message = await readStructuredErrorReason(response);

  const redacted = sensitiveValues.reduce<string>((current, value) => {
    const candidates = [...new Set([value, value?.trim()])].filter(
      (candidate): candidate is string => Boolean(candidate),
    );
    return candidates.reduce<string>(
      (next, candidate) => next.split(candidate).join("[已隐藏]"),
      current,
    );
  }, message);
  const bounded = redacted
    .replace(/[\r\n]+/g, " ")
    .slice(0, MAX_PROVIDER_ERROR_LENGTH)
    .trim();
  return new Error(
    bounded
      ? `API 错误 ${response.status}: ${bounded}`
      : `API 错误 ${response.status}`,
  );
}
