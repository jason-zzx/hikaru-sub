import {
  clampProviderInteger,
  TRANSLATION_PROVIDER_LIMITS,
} from "@/constants/translationProviders";

interface ScheduledRequest<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export class RequestScheduler {
  private readonly maxConcurrency: number;
  private readonly startIntervalMs: number;
  private readonly queue: ScheduledRequest<unknown>[] = [];
  private activeSlots = 0;
  private nextStartAt = 0;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxConcurrency: number, requestsPerMinute: number) {
    this.maxConcurrency = clampProviderInteger(
      maxConcurrency,
      TRANSLATION_PROVIDER_LIMITS.maxConcurrency,
    );
    const normalizedRpm = clampProviderInteger(
      requestsPerMinute,
      TRANSLATION_PROVIDER_LIMITS.requestsPerMinute,
    );
    this.startIntervalMs = 60_000 / normalizedRpm;
  }

  schedule<T>(
    run: () => Promise<T>,
    signal?: AbortSignal,
    priority = false,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    return new Promise<T>((resolve, reject) => {
      const request = {
        run,
        resolve,
        reject,
        signal,
      } as ScheduledRequest<unknown>;
      if (signal) {
        request.onAbort = () => this.cancel(request, signal);
        signal.addEventListener("abort", request.onAbort, { once: true });
      }
      if (priority) this.queue.unshift(request);
      else this.queue.push(request);
      this.drain();
    });
  }

  private cancel(
    request: ScheduledRequest<unknown>,
    signal: AbortSignal,
  ): void {
    const index = this.queue.indexOf(request);
    if (index < 0) return;

    this.queue.splice(index, 1);
    request.reject(abortReason(signal));
    if (this.queue.length === 0 && this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.drain();
  }

  private drain(): void {
    if (
      this.startTimer !== null ||
      this.activeSlots >= this.maxConcurrency ||
      this.queue.length === 0
    ) {
      return;
    }

    const delay = Math.max(0, this.nextStartAt - Date.now());
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      const request = this.queue.shift();
      if (!request) {
        this.drain();
        return;
      }
      if (request.signal && request.onAbort) {
        request.signal.removeEventListener("abort", request.onAbort);
      }
      this.activeSlots += 1;
      this.nextStartAt = Date.now() + this.startIntervalMs;
      this.run(request);
      this.drain();
    }, delay);
  }

  private run(request: ScheduledRequest<unknown>): void {
    void Promise.resolve()
      .then(request.run)
      .finally(() => {
        this.activeSlots -= 1;
        this.drain();
      })
      .then(request.resolve, request.reject);
  }
}
