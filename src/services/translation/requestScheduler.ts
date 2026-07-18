import {
  clampProviderInteger,
  TRANSLATION_PROVIDER_LIMITS,
} from "@/constants/translationProviders";

interface ScheduledRequest<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
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

  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve, reject } as ScheduledRequest<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    if (
      this.startTimer !== null ||
      this.activeSlots >= this.maxConcurrency ||
      this.queue.length === 0
    ) {
      return;
    }

    const request = this.queue.shift();
    if (!request) return;

    this.activeSlots += 1;
    const delay = Math.max(0, this.nextStartAt - Date.now());
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.nextStartAt = Date.now() + this.startIntervalMs;
      this.run(request);
      this.drain();
    }, delay);
  }

  private run(request: ScheduledRequest<unknown>): void {
    void request
      .run()
      .finally(() => {
        this.activeSlots -= 1;
        this.drain();
      })
      .then(request.resolve, request.reject);
  }
}
