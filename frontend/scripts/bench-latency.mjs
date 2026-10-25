#!/usr/bin/env node
/**
 * Real-browser latency from the last input event to a visible suggestion.
 * Run with existing servers: node scripts/bench-latency.mjs
 * Uses an isolated Chromium context and synthetic, public benchmark fixtures.
 * No screenshots, traces, prompt text, generated text, settings writes, or handoffs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = {
  appUrl: "http://localhost:3000",
  apiUrl: "http://127.0.0.1:8001",
  scenario: "repeat",
  output: resolve(repository, "docs/evidence/latency-browser.json"),
  rounds: 3,
  expectedDelayMs: 150,
  typingDelayMs: 5,
  timeoutMs: 30000,
};
const cliNames = {
  "--app-url": "appUrl",
  "--api-url": "apiUrl",
  "--scenario": "scenario",
  "--output": "output",
  "--rounds": "rounds",
  "--expected-delay-ms": "expectedDelayMs",
  "--typing-delay-ms": "typingDelayMs",
  "--timeout-ms": "timeoutMs",
};
const supplied = new Set();
for (let index = 2; index < process.argv.length; index += 2) {
  const argument = process.argv[index];
  if (argument === "--help") {
    console.log(
      "node scripts/bench-latency.mjs [--app-url URL] [--api-url URL] [--output PATH] " +
        "[--scenario repeat|challenge] [--rounds N] [--expected-delay-ms 150] " +
        "[--typing-delay-ms 5] [--timeout-ms 30000]\n" +
        "repeat: cases 7–9, three rounds, latency-browser.json. " +
        "challenge: 12 distinct cases, one round, latency-browser-challenge.json.\n" +
        "Requires live frontend/backend and the expected existing trigger setting. " +
        "Makes real provider calls; saves metadata only.",
    );
    process.exit(0);
  }
  const key = cliNames[argument];
  const value = process.argv[index + 1];
  if (!key || value === undefined) throw new Error("Unknown argument or missing value; use --help");
  options[key] = typeof options[key] === "number" ? Number(value) : value;
  supplied.add(key);
}
if (!["repeat", "challenge"].includes(options.scenario)) throw new Error("scenario must be repeat or challenge");
if (options.scenario === "challenge") {
  if (!supplied.has("rounds")) options.rounds = 1;
  if (!supplied.has("output")) options.output = resolve(repository, "docs/evidence/latency-browser-challenge.json");
}
for (const key of ["rounds", "expectedDelayMs", "typingDelayMs", "timeoutMs"]) {
  if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`);
}
options.appUrl = options.appUrl.replace(/\/$/, "");
options.apiUrl = options.apiUrl.replace(/\/$/, "");

const fixtureSource = await readFile(resolve(repository, "backend/scripts/bench_enhance.py"), "utf8");
const fixtureBlock = fixtureSource.match(/PROMPTS = \[([\s\S]*?)\n\]/)?.[1];
if (!fixtureBlock) throw new Error("Could not locate backend benchmark fixtures");
const fixturePrompts = fixtureBlock
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line.trim().replace(/,$/, "")));
if (fixturePrompts.length < 9) throw new Error("Expected backend benchmark cases 7–9");

// Fixed synthetic prompts are source code, but never enter the saved evidence.
// These are a coverage challenge, not hand-labelled expected model responses.
const challengeFixtures = [
  {
    id: "fresh_insertion_retries",
    inputMode: "single_insertion",
    family: "first_insertion",
    prompt: "Harden transient payment failures using capped exponential backoff and",
  },
  {
    id: "new_settings_tests",
    inputMode: "typed",
    family: "new_prompt",
    prompt: "Write Vitest tests for the account settings form that check",
  },
  {
    id: "paraphrased_online_migration",
    inputMode: "typed",
    family: "semantic_paraphrase",
    prompt:
      "Change a populated table so every row eventually requires a value without interrupting ongoing writes, starting with",
  },
  {
    id: "vague_api_performance",
    inputMode: "typed",
    family: "ambiguous",
    prompt: "Make the API faster",
  },
  {
    id: "negated_web_frameworks",
    inputMode: "typed",
    family: "negation",
    prompt: "Add request validation without Express or Fastify, using",
  },
  {
    id: "partial_retry_word",
    inputMode: "typed",
    family: "partial_word",
    prompt: "Add retr",
  },
  {
    id: "spanish_retries",
    inputMode: "typed",
    family: "non_english",
    prompt: "Añade reintentos al cliente de pagos con",
  },
  {
    id: "unicode_test_suite",
    inputMode: "typed",
    family: "unicode",
    prompt: "Improve the 🧪 test suite so that",
  },
  {
    id: "complete_arithmetic",
    inputMode: "single_insertion",
    family: "complete_prompt",
    prompt: "Calculate 2 + 2.",
  },
  {
    id: "ambiguous_migration_plan",
    inputMode: "typed",
    family: "ambiguous",
    prompt: "Write a migration plan for our database.",
  },
  {
    id: "inflight_append_retries",
    inputMode: "append_after_request",
    family: "inflight_append",
    prefix: "Add retries with exponential backoff and",
    suffix: " jitter",
  },
  {
    id: "inflight_append_negation",
    inputMode: "append_after_request",
    family: "inflight_semantic_change",
    prefix: "Create a zero-downtime migration that",
    suffix: " must not use PostgreSQL-specific features, and",
  },
].map((fixture, index) => ({
  ...fixture,
  caseNumber: index + 1,
  prompt: fixture.prompt ?? fixture.prefix + fixture.suffix,
}));
const fixtures =
  options.scenario === "challenge"
    ? challengeFixtures
    : fixturePrompts.slice(6, 9).map((prompt, index) => ({
        id: `backend_case_${index + 7}`,
        caseNumber: index + 7,
        inputMode: "typed",
        family: "exact_prompt_repeat",
        prompt,
      }));

const sourcePaths = [
  "backend/app/main.py",
  "backend/app/config.py",
  "backend/app/llm/local_embeddings.py",
  "backend/app/pipeline/catalog.py",
  "backend/app/pipeline/semantic.py",
  "backend/app/pipeline/complete.py",
  "backend/app/pipeline/run.py",
  "backend/app/settings_store.py",
  "frontend/src/lib/settings/defaults.ts",
  "frontend/src/lib/enhance/use-enhance.ts",
  "frontend/src/lib/enhance/state.ts",
  "frontend/src/components/refine/prompt-editor.tsx",
  "frontend/src/components/refine/refine-view.tsx",
  "frontend/src/components/refine/question-card.tsx",
  "frontend/scripts/bench-latency.mjs",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(resolve(repository, path)))
        .digest("hex"),
    ]),
  ),
);

const rounded = (number) => (typeof number === "number" ? Math.round(number * 10) / 10 : null);
function distribution(values) {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50_ms: null, p95_ms: null, min_ms: null, max_ms: null };
  const midpoint = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    p50_ms: rounded(sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2),
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min_ms: sorted[0],
    max_ms: sorted.at(-1),
  };
}

function summarize(samples) {
  return {
    samples: samples.length,
    errors: samples.filter((sample) => sample.outcome === "error").length,
    none: samples.filter((sample) => sample.outcome === "none").length,
    visible_suggestions: samples.filter((sample) => sample.outcome === "visible").length,
    salvaged_visible_suggestions: samples.filter(
      (sample) => sample.outcome === "visible" && sample.measurement_route === "inflight_suffix",
    ).length,
    within_500ms_visible_suggestions: samples.filter(
      (sample) => sample.outcome === "visible" && sample.last_input_to_visible_ms <= 500,
    ).length,
    visible_coverage: samples.length
      ? samples.filter((sample) => sample.outcome === "visible").length / samples.length
      : null,
    subsecond_visible_suggestions: samples.filter(
      (sample) => sample.outcome === "visible" && sample.last_input_to_visible_ms < 1000,
    ).length,
    results: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.result_type))].map((type) => [
        type,
        samples.filter((sample) => sample.result_type === type).length,
      ]),
    ),
    last_input_to_visible: distribution(samples.map((sample) => sample.last_input_to_visible_ms)),
    last_input_to_response_json: distribution(samples.map((sample) => sample.last_input_to_response_json_ms)),
    last_input_to_request: distribution(samples.map((sample) => sample.last_input_to_request_ms)),
    request_to_response_json: distribution(samples.map((sample) => sample.request_to_response_json_ms)),
    response_json_to_visible: distribution(samples.map((sample) => sample.response_json_to_visible_ms)),
    extra_requests: samples.reduce((sum, sample) => sum + Math.max(0, sample.request_count - 1), 0),
  };
}

// Runs only inside the ephemeral page. Exact prompts exist transiently for request matching.
function installBrowserMeasurements(apiUrl) {
  window.localStorage.setItem("pe.apiBase", apiUrl);
  window.localStorage.removeItem("pe.refine.draft");
  const bench = { active: null };
  window.__latencyBench = bench;
  const originalFetch = window.fetch.bind(window);

  const visible = (node) => {
    if (!node || !node.isConnected || !node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  const suggestionNode = (sample) => {
    const editor = document.querySelector('textarea[aria-label="Prompt"]');
    if (editor?.value !== sample.expectedPrompt) return null;
    const ghost = document.querySelector('[data-testid="ghost-text"]');
    if (ghost?.querySelector(".text-ghost")?.textContent?.length && visible(ghost)) {
      const request = sample.requests.find((item) => item.requestId === ghost.dataset.requestId);
      if (request?.jsonAt && request.resultType === "autocomplete") {
        return { node: ghost, request, renderRevision: Number(ghost.dataset.renderRevision) };
      }
    }
    const request = sample.finalRequest;
    if (!request?.jsonAt || request.resultType !== "multiple_choice") return null;
    const question = document.querySelector('section[aria-label="Question"]');
    return question?.querySelectorAll('[role="radio"]').length >= 2 && visible(question)
      ? { node: question, request, renderRevision: request.revision }
      : null;
  };
  const inspect = () => {
    const sample = bench.active;
    if (!sample || sample.paintAt || sample.outcome === "error") return;
    const displayed = suggestionNode(sample);
    if (!displayed) {
      // Compositor animations do not necessarily mutate DOM attributes each frame.
      if (
        !sample.visibilityFramePending &&
        sample.outcome === null &&
        sample.requests.some(
          (request) => request.jsonAt && ["autocomplete", "multiple_choice"].includes(request.resultType),
        )
      ) {
        sample.visibilityFramePending = true;
        requestAnimationFrame(() => {
          sample.visibilityFramePending = false;
          if (bench.active === sample) inspect();
        });
      }
      return;
    }
    if (sample.paintPending) return;
    sample.domAt ??= performance.now();
    sample.paintPending = true;
    // A rendering opportunity proxy, not a claim to have hardware presentation timestamps.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        sample.paintPending = false;
        if (bench.active !== sample) return;
        const current = suggestionNode(sample);
        if (current?.node !== displayed.node || current?.request !== displayed.request) {
          sample.domAt = null;
          inspect();
          return;
        }
        sample.paintAt = performance.now();
        sample.visibleRequest = displayed.request;
        sample.renderRevision = displayed.renderRevision;
        sample.outcome = "visible";
      }),
    );
  };
  document.addEventListener(
    "input",
    (event) => {
      const sample = bench.active;
      if (!sample || event.target?.getAttribute?.("aria-label") !== "Prompt") return;
      sample.inputEvents += 1;
      sample.allInputsTrusted &&= event.isTrusted;
      sample.firstInputAt ??= performance.now();
      sample.lastInputAt = performance.now();
      sample.lastInputLength = event.target.value.length;
      sample.lastInputType = event.inputType ?? null;
    },
    true,
  );
  new MutationObserver(inspect).observe(document, { subtree: true, childList: true, attributes: true });

  window.fetch = async (input, init) => {
    const sample = bench.active;
    const url = typeof input === "string" ? input : input.url;
    let record = null;
    if (sample && url === `${apiUrl}/v1/enhance` && init?.method === "POST") {
      const request = JSON.parse(init.body);
      record = {
        requestId: request.request_id,
        revision: request.prompt_revision,
        promptLength: request.prompt.length,
        requestAt: performance.now(),
        exactFinalPrompt: request.prompt === sample.expectedPrompt,
        headersAt: null,
        jsonAt: null,
        status: null,
        resultType: null,
        errorCode: null,
      };
      sample.requests.push(record);
      if (record.exactFinalPrompt) sample.finalRequest = record;
    }
    try {
      const response = await originalFetch(input, init);
      if (!record) return response;
      record.headersAt = performance.now();
      record.status = response.status;
      const originalJson = response.json.bind(response);
      response.json = async (...args) => {
        try {
          const body = await originalJson(...args);
          record.jsonAt = performance.now();
          record.resultType = body?.type ?? "error";
          record.errorCode = typeof body?.error?.code === "string" ? body.error.code : null;
          if (record === sample.finalRequest) {
            if (!sample.paintAt) {
              if (!response.ok) sample.outcome = "error";
              else if (record.resultType === "none") sample.outcome = "none";
            }
            inspect();
          }
          return body;
        } catch (error) {
          record.errorCode = "response_json_failed";
          if (record === sample.finalRequest && !sample.paintAt) sample.outcome = "error";
          throw error;
        }
      };
      return response;
    } catch (error) {
      if (record) {
        record.errorCode = error?.name === "AbortError" ? "aborted" : "fetch_failed";
        if (record === sample.finalRequest && !sample.paintAt) sample.outcome = "error";
      }
      throw error;
    }
  };
}

let browser;
const result = {
  measured_at: new Date().toISOString(),
  source_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  source_tree_dirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim(),
  ),
  source_files_sha256: sourceHashes,
  scenario: options.scenario === "repeat" ? "browser_exact_prompt_repeat" : "browser_new_prompt_challenge",
  app_url: options.appUrl,
  api_url: options.apiUrl,
  server_mode: "existing Next.js development server; not a production-build measurement",
  browser: null,
  headless: true,
  viewport: { width: 1440, height: 900 },
  fixture_source:
    options.scenario === "repeat"
      ? "backend/scripts/bench_enhance.py PROMPTS[6:9]"
      : "frontend/scripts/bench-latency.mjs challengeFixtures",
  fixture_sha256: createHash("sha256")
    .update(JSON.stringify(options.scenario === "repeat" ? fixturePrompts.slice(6, 9) : challengeFixtures))
    .digest("hex"),
  fixture_ids: fixtures.map((fixture) => fixture.id),
  rounds: options.rounds,
  typing_delay_ms: options.typingDelayMs,
  expected_trigger_delay_ms: options.expectedDelayMs,
  configured_trigger_delay_ms: null,
  measurement: {
    clock: "performance.now() in one page",
    last_input: "capture-phase trusted input event from the final character or single insertion",
    single_insertion: "Playwright keyboard.insertText; paste-equivalent insertion, not an OS clipboard paste",
    append_after_request: "append after the prefix application fetch starts; final append input remains time zero",
    request_start: "application fetch invocation, not network packet transmission",
    response: "fetch resolves at headers, then the application response.json() resolves",
    visible: "visible populated ghost/question followed by two requestAnimationFrame callbacks",
    limitations: [
      "Double animation frame is a rendering-opportunity proxy, not hardware presentation telemetry.",
      "Development server, localhost networking, rapid deterministic typing, and small samples are not a production SLA.",
      "Nearest-rank p95 equals the maximum for the default nine- or twelve-sample run.",
      options.scenario === "repeat"
        ? "Backend/provider caches are not reset; rounds are exact repeats, not isolated cold starts."
        : "Distinct prompts are new to this run; backend/provider caches are not reset and this is not certified cold-start evidence.",
      "Source hashes describe files before browser launch, not attestation of code loaded by existing server processes.",
      "none responses have no visible-suggestion latency and are reported separately.",
      "Visible coverage measures rendered responses, not independent semantic quality or correct grounding.",
      "A ghost is attributed by its rendered source request ID; in-flight suffix reuse is reported separately from exact-current responses.",
      "Streaming previews are not measured; the attributed response must have completed application JSON parsing.",
    ],
  },
  browser_page_errors: 0,
  setup_phase: "launch",
  setup_error: null,
  samples: [],
};

try {
  browser = await chromium.launch({ headless: true });
  result.browser = `Chromium ${browser.version()}`;
  const context = await browser.newContext({ viewport: result.viewport });
  await context.addInitScript(installBrowserMeasurements, options.apiUrl);
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  page.on("pageerror", () => result.browser_page_errors++);
  const settingsResponse = page.waitForResponse(
    (response) => response.url() === `${options.apiUrl}/v1/settings` && response.request().method() === "GET",
  );
  result.setup_phase = "navigation";
  await page.goto(`${options.appUrl}/refine`, { waitUntil: "domcontentloaded" });
  result.setup_phase = "settings_response";
  const settings = await (await settingsResponse).json();
  result.configured_trigger_delay_ms = settings.trigger_delay_ms;
  if (settings.trigger_delay_ms !== options.expectedDelayMs) throw new Error("unexpected_trigger_delay");
  if (!settings.autocomplete_enabled && !settings.questions_enabled) throw new Error("enhancement_disabled");
  const editor = page.getByRole("textbox", { name: "Prompt", exact: true });
  result.setup_phase = "editor_ready";
  await editor.waitFor({ state: "visible" });
  // Let the fetched settings commit before measuring; this does not change their values.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  result.setup_phase = "complete";

  for (let round = 1; round <= options.rounds; round++) {
    for (const fixture of fixtures) {
      const { prompt } = fixture;
      await page.evaluate(() => (window.__latencyBench.active = null));
      await editor.fill("");
      await page.getByTestId("ghost-text").waitFor({ state: "hidden" });
      await page.getByLabel("Question", { exact: true }).waitFor({ state: "hidden" });
      await editor.click();
      await page.evaluate((expectedPrompt) => {
        window.__latencyBench.active = {
          expectedPrompt,
          inputEvents: 0,
          allInputsTrusted: true,
          firstInputAt: null,
          lastInputAt: null,
          lastInputLength: 0,
          lastInputType: null,
          requests: [],
          finalRequest: null,
          visibleRequest: null,
          renderRevision: null,
          domAt: null,
          paintAt: null,
          paintPending: false,
          visibilityFramePending: false,
          outcome: null,
        };
      }, prompt);
      let sampleError = null;
      try {
        if (fixture.inputMode === "single_insertion") {
          await page.keyboard.insertText(prompt);
        } else if (fixture.inputMode === "append_after_request") {
          await editor.pressSequentially(fixture.prefix, { delay: options.typingDelayMs });
          await page.waitForFunction(() => window.__latencyBench.active?.requests.length > 0, undefined, {
            timeout: options.timeoutMs,
          });
          await editor.pressSequentially(fixture.suffix, { delay: options.typingDelayMs });
        } else {
          await editor.pressSequentially(prompt, { delay: options.typingDelayMs });
        }
        await page.waitForFunction(() => window.__latencyBench.active?.outcome !== null, undefined, {
          timeout: options.timeoutMs,
        });
      } catch (error) {
        sampleError = error?.name === "TimeoutError" ? "sample_timeout" : "browser_interaction_failed";
      }
      // Explicit allow-list: no prompt text or generated text crosses into saved evidence.
      const observed = await page.evaluate(() => {
        const sample = window.__latencyBench.active;
        const request = sample.visibleRequest ?? sample.finalRequest;
        const since = (time, start) => (typeof time === "number" && typeof start === "number" ? time - start : null);
        return {
          request_id: request?.requestId ?? null,
          prompt_revision: request?.revision ?? null,
          render_revision: sample.renderRevision,
          final_request_id: sample.finalRequest?.requestId ?? null,
          final_response_type: sample.finalRequest?.resultType ?? null,
          measurement_route: sample.visibleRequest
            ? sample.visibleRequest.exactFinalPrompt
              ? "exact_current"
              : "inflight_suffix"
            : null,
          append_units_consumed: sample.visibleRequest
            ? sample.lastInputLength - sample.visibleRequest.promptLength
            : null,
          status: request?.status ?? null,
          result_type: request?.resultType ?? "error",
          outcome: sample.outcome,
          error_code: request?.errorCode ?? null,
          input_events: sample.inputEvents,
          all_inputs_trusted: sample.allInputsTrusted,
          final_input_units: sample.lastInputLength,
          last_input_type: sample.lastInputType,
          request_count: sample.requests.length,
          aborted_request_count: sample.requests.filter((item) => item.errorCode === "aborted").length,
          prefix_response_before_final_input_count: sample.requests.filter(
            (item) => !item.exactFinalPrompt && typeof item.jsonAt === "number" && item.jsonAt < sample.lastInputAt,
          ).length,
          typing_duration_ms: since(sample.lastInputAt, sample.firstInputAt),
          last_input_to_request_ms: since(request?.requestAt, sample.lastInputAt),
          request_started_before_last_input_ms: request ? Math.max(0, sample.lastInputAt - request.requestAt) : null,
          last_input_to_response_headers_ms: since(request?.headersAt, sample.lastInputAt),
          last_input_to_response_json_ms: since(request?.jsonAt, sample.lastInputAt),
          last_input_to_dom_ms: since(sample.domAt, sample.lastInputAt),
          last_input_to_visible_ms: since(sample.paintAt, sample.lastInputAt),
          request_to_response_json_ms: since(request?.jsonAt, request?.requestAt),
          response_json_to_visible_ms: since(sample.paintAt, request?.jsonAt),
        };
      });
      const row = {
        case: fixture.caseNumber,
        fixture_id: fixture.id,
        input_mode: fixture.inputMode,
        family: fixture.family,
        round,
        ...observed,
      };
      for (const key of Object.keys(row)) if (key.endsWith("_ms")) row[key] = rounded(row[key]);
      if (sampleError) {
        row.outcome = "error";
        row.error_code ??= sampleError;
      }
      if (!row.all_inputs_trusted || row.final_input_units !== prompt.length) {
        row.outcome = "error";
        row.error_code = "invalid_input_measurement";
      }
      result.samples.push(row);
      console.log(JSON.stringify(row));
    }
  }
} catch (error) {
  const allowedErrors = new Set(["unexpected_trigger_delay", "enhancement_disabled"]);
  result.setup_error = allowedErrors.has(error?.message) ? error.message : `setup_${error?.name ?? "Error"}`;
} finally {
  if (browser) await browser.close();
  result.summary = summarize(result.samples);
  result.by_round = Object.fromEntries(
    [...new Set(result.samples.map((sample) => sample.round))].map((round) => [
      String(round),
      summarize(result.samples.filter((sample) => sample.round === round)),
    ]),
  );
  result.by_input_mode = Object.fromEntries(
    [...new Set(result.samples.map((sample) => sample.input_mode))].map((mode) => [
      mode,
      summarize(result.samples.filter((sample) => sample.input_mode === mode)),
    ]),
  );
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ setup_error: result.setup_error, summary: result.summary, by_round: result.by_round }));
}
if (result.setup_error || result.summary.errors) process.exitCode = 1;
