#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function fail(message) {
  throw new Error(`Native ASR runtime smoke failed: ${message}`);
}

export function smokeRuntime({ workerPath, modelPath, audioPath, timeoutMs = 1_800_000 }) {
  const worker = realpathSync(workerPath);
  const model = realpathSync(modelPath);
  const audio = realpathSync(audioPath);
  const request = {
    protocolVersion: 1,
    jobId: "runtime-functional-smoke",
    engine: "faster-whisper",
    backend: "ctranslate2",
    modelPaths: [{ role: "model", path: model }],
    audioPath: audio,
    device: "cpu",
    language: "ja",
    useVad: false,
  };
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const result = spawnSync(worker, [], {
    cwd: dirname(worker),
    input: `${JSON.stringify(request)}\n`,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${dirname(worker)};${systemRoot}\\System32`,
    },
  });
  if (result.error) fail(result.error.message);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let stdout;
  let stderr;
  try {
    stdout = decoder.decode(result.stdout ?? Buffer.alloc(0));
    stderr = decoder.decode(result.stderr ?? Buffer.alloc(0));
  } catch {
    fail("worker output is not valid UTF-8");
  }
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const events = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      fail(`stdout contains non-JSONL output: ${line.slice(0, 120)}`);
    }
  });
  if (result.status !== 0) {
    fail(`worker exited ${result.status}: ${stderr.trim()} ${stdout.trim()}`);
  }
  const readyIndex = events.findIndex((event) => event.event === "ready");
  const completedIndex = events.findIndex((event) => event.event === "completed");
  if (readyIndex !== 0 || completedIndex !== events.length - 1) {
    fail("protocol order must be ready -> progress/segments -> completed");
  }
  const durationMs = events[readyIndex].durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) fail("ready duration is invalid");
  let processedMs = 0;
  let previousStartMs = -1;
  let segmentCount = 0;
  for (const event of events.slice(1, -1)) {
    if (event.event === "progress") {
      if (
        !Number.isSafeInteger(event.processedMs) ||
        event.processedMs < processedMs ||
        event.processedMs > durationMs
      ) {
        fail("progress is not monotonic and audio-bounded");
      }
      processedMs = event.processedMs;
      continue;
    }
    if (event.event === "segment") {
      const { startMs, endMs, text } = event;
      if (
        !Number.isSafeInteger(startMs) ||
        !Number.isSafeInteger(endMs) ||
        startMs < previousStartMs ||
        startMs < 0 ||
        endMs <= startMs ||
        endMs > durationMs ||
        typeof text !== "string" ||
        text.trim().length === 0
      ) {
        fail("segment text or timeline is invalid");
      }
      previousStartMs = startMs;
      segmentCount += 1;
      continue;
    }
    fail(`unexpected protocol event: ${event.event}`);
  }
  if (segmentCount === 0 || processedMs !== durationMs) {
    fail("worker produced no segments or did not reach the audio end");
  }
  if (events[completedIndex].durationMs !== durationMs) {
    fail("completed duration drifted from ready");
  }
  return { durationMs, segmentCount, eventCount: events.length };
}

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const workerPath = value("--worker");
    const modelPath = value("--model");
    const audioPath = value("--audio");
    if (!workerPath || !modelPath || !audioPath) {
      fail("--worker, --model, and --audio are required");
    }
    const result = smokeRuntime({
      workerPath: resolve(workerPath),
      modelPath: resolve(modelPath),
      audioPath: resolve(audioPath),
      timeoutMs: Number(value("--timeout-ms") ?? 1_800_000),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
