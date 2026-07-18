const MAX_PROVIDER_ERROR_LENGTH = 300;
export const DEFAULT_MODEL_LIST_TIMEOUT = 30_000;

export function buildProviderUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const childPath = path.replace(/^\/+/, "");
  url.pathname = `${basePath}/${childPath}`;
  return url;
}

export function fetchWithTimeout(
  input: URL,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeout) });
}

export async function providerHttpError(
  response: Response,
  sensitiveValues: Array<string | undefined> = [],
): Promise<Error> {
  let message = "";
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      const candidate =
        typeof parsed.error === "object" && parsed.error
          ? parsed.error.message
          : typeof parsed.error === "string"
            ? parsed.error
            : parsed.message;
      if (typeof candidate === "string") message = candidate;
    } catch {
      // Non-JSON bodies may echo request payloads; keep only the status.
    }
  } catch {
    // Status remains enough when the provider response cannot be read.
  }

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
