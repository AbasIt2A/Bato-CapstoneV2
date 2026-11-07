// Generation retry: a timeout must count as a failed attempt, not end the
// request. Observed 2026-11-07: one slow Gemini response threw out of the
// retry loop and the user got the service-error reply on attempt 1 of 3.
// Run with: deno test --allow-read --allow-env tests/gemini_retry_test.ts

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { generateReply } from "../supabase/functions/_shared/gemini.ts";

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function timeoutError(): Error {
  const err = new Error("Signal timed out.");
  err.name = "TimeoutError";
  return err;
}

async function withFetch<T>(
  stub: () => Promise<Response>,
  run: () => Promise<T>,
): Promise<{ result: T; calls: number }> {
  const original = globalThis.fetch;
  const hadKey = Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY", "test-key");
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return stub();
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
    if (hadKey === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", hadKey);
  }
}

const args = { systemPrompt: "system", message: "question" };

Deno.test("generateReply: a timeout is retried, and a later success is returned", async () => {
  let n = 0;
  const { result, calls } = await withFetch(
    () => (++n === 1 ? Promise.reject(timeoutError()) : Promise.resolve(okResponse("answer"))),
    () => generateReply(args),
  );
  assertEquals(result, "answer");
  assertEquals(calls, 2);
});

Deno.test("generateReply: a network error is retried like a 503", async () => {
  let n = 0;
  const { result } = await withFetch(
    () => (++n === 1 ? Promise.reject(new TypeError("connection reset")) : Promise.resolve(okResponse("ok"))),
    () => generateReply(args),
  );
  assertEquals(result, "ok");
});

Deno.test("generateReply: still throws once every attempt has failed", async () => {
  await assertRejects(
    () =>
      withFetch(
        () => Promise.reject(timeoutError()),
        () => generateReply(args),
      ),
    Error,
    "timed out",
  );
});
