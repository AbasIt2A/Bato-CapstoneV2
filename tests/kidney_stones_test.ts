import { assert, assertEquals } from "jsr:@std/assert@1";
import { classifyQuery } from "../supabase/functions/_shared/gate.ts";
import { GENERAL_CHAT_SYSTEM_PROMPT } from "../supabase/functions/_shared/prompts.ts";
import { chunkMarkdownDocument } from "../scripts/chunker.ts";

Deno.test("general gate and answer prompts admit kidney-stone education without personal diagnosis", async () => {
  const previous = Deno.env.get("GROQ_API_KEY");
  const originalFetch = globalThis.fetch;
  let gatePrompt = "";
  Deno.env.set("GROQ_API_KEY", "stub-key");
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    gatePrompt = body.messages[0].content;
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        in_scope: true, injection_detected: false, reason: "kidney stones",
      }) } }],
    }), { status: 200 }));
  }) as typeof fetch;
  try {
    for (const query of [
      "How can I determine if I have a kidney stone?",
      "what are the risk of taking a medication of kidney stone?",
    ]) {
      const verdict = await classifyQuery(query);
      assertEquals(verdict.in_scope, true);
    }
    assert(gatePrompt.includes("kidney stones"));
    assert(gatePrompt.includes("medicines"));
    assert(GENERAL_CHAT_SYSTEM_PROMPT.includes("kidney stones"));
    assert(GENERAL_CHAT_SYSTEM_PROMPT.includes("medicine"));
    assert(GENERAL_CHAT_SYSTEM_PROMPT.includes("cannot diagnose"));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", previous);
  }
});

Deno.test("kidney-stone source has separate diagnosis, medication, and prevention chunks", async () => {
  const text = await Deno.readTextFile(new URL(
    "../knowledge/official-health-body/niddk/kidney-stones.md",
    import.meta.url,
  ));
  const chunks = chunkMarkdownDocument(text);
  assertEquals(chunks.length, 5);
  assert(chunks.every((chunk) => chunk.source === "NIDDK"));
  assert(chunks.every((chunk) => chunk.scopes.includes("general_education")));
  assert(chunks[0].content.includes("Urine and blood tests"));
  assert(chunks[1].content.includes("side effects"));
  assert(chunks[4].content.includes("stone type"));
});
