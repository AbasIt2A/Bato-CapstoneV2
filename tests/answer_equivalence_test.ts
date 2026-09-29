import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  answersEquivalent,
  REWORD_SYSTEM_PROMPT,
  rewordAnswer,
} from "../supabase/functions/_shared/answer-equivalence.ts";

const ORIGINAL =
  "A blood test checks kidney function. Seek urgent care if you cannot urinate.";
const CANDIDATE =
  "Kidney function can be checked with a blood test. Get urgent care if you cannot urinate.";

function groqReply(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function withGroq(
  key: string | undefined,
  reply: Response | Error,
  test: (
    calls: {
      url: string;
      body: Record<string, unknown>;
      signal?: AbortSignal;
      authorization?: string;
    }[],
  ) => Promise<void>,
): Promise<void> {
  const previousKey = Deno.env.get("GROQ_API_KEY");
  const previousModel = Deno.env.get("GROQ_GATE_MODEL");
  const originalFetch = globalThis.fetch;
  const calls: {
    url: string;
    body: Record<string, unknown>;
    signal?: AbortSignal;
    authorization?: string;
  }[] = [];
  if (key === undefined) Deno.env.delete("GROQ_API_KEY");
  else Deno.env.set("GROQ_API_KEY", key);
  Deno.env.set("GROQ_GATE_MODEL", "test-gate-model");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      signal: init?.signal ?? undefined,
      authorization: (init?.headers as Record<string, string> | undefined)
        ?.Authorization,
    });
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve(reply);
  }) as typeof fetch;
  try {
    await test(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", previousKey);
    if (previousModel === undefined) Deno.env.delete("GROQ_GATE_MODEL");
    else Deno.env.set("GROQ_GATE_MODEL", previousModel);
  }
}

Deno.test("equivalence: a strict Groq verdict approves rewording without sending answer text as instructions", async () => {
  await withGroq(
    "groq-test",
    groqReply('{"equivalent":true}'),
    async (calls) => {
      assertEquals(await answersEquivalent(ORIGINAL, CANDIDATE), true);
      assertEquals(calls.length, 1);
      assertEquals(new URL(calls[0].url).hostname, "api.groq.com");
      assertEquals(calls[0].body.model, "test-gate-model");
      assertEquals(calls[0].body.temperature, 0);
      assertEquals(calls[0].body.response_format, { type: "json_object" });
      assertEquals(calls[0].signal instanceof AbortSignal, true);
      const messages = calls[0].body.messages as {
        role: string;
        content: string;
      }[];
      assertEquals(messages.map((message) => message.role), ["system", "user"]);
      assertEquals(messages[0].content.includes(ORIGINAL), false);
      assertEquals(messages[0].content.includes(CANDIDATE), false);
      assertStringIncludes(messages[0].content, "warnings");
      assertStringIncludes(messages[0].content, "units");
      assertEquals(JSON.parse(messages[1].content), {
        original: ORIGINAL,
        candidate: CANDIDATE,
      });
    },
  );
});

Deno.test("equivalence: rejects a model-declared difference", async () => {
  await withGroq("groq-test", groqReply('{"equivalent":false}'), async () => {
    assertEquals(
      await answersEquivalent(ORIGINAL, "A urine test checks kidney function."),
      false,
    );
  });
});

Deno.test("equivalence: changed thresholds are vetoed before asking the model", async () => {
  await withGroq(
    "groq-test",
    groqReply('{"equivalent":true}'),
    async (calls) => {
      assertEquals(
        await answersEquivalent(
          "An eGFR below 60 may signal CKD.",
          "An eGFR above 60 may signal CKD.",
        ),
        false,
      );
      assertEquals(
        await answersEquivalent(
          "An eGFR below 60 may signal CKD.",
          "An eGFR below 90 may signal CKD.",
        ),
        false,
      );
      assertEquals(calls.length, 0);
      assertEquals(
        await answersEquivalent(
          "An eGFR below 60 may signal CKD.",
          "An eGFR under 60 could signal CKD.",
        ),
        true,
      );
      assertEquals(calls.length, 1);
    },
  );
});

Deno.test("equivalence: no key or blank answer never makes a provider call", async () => {
  await withGroq(undefined, groqReply('{"equivalent":true}'), async (calls) => {
    assertEquals(await answersEquivalent(ORIGINAL, CANDIDATE), false);
    assertEquals(calls.length, 0);
  });
  await withGroq(
    "groq-test",
    groqReply('{"equivalent":true}'),
    async (calls) => {
      assertEquals(await answersEquivalent(ORIGINAL, "  "), false);
      assertEquals(calls.length, 0);
    },
  );
});

Deno.test("equivalence: provider errors and malformed verdicts fail closed", async () => {
  for (
    const reply of [
      new Response("busy", { status: 503 }),
      groqReply(""),
      groqReply("not json"),
      groqReply('{"equivalent":"true"}'),
      groqReply('{"equivalent":true,"warning":"numbers changed"}'),
      new Error("timeout"),
    ]
  ) {
    await withGroq("groq-test", reply, async () => {
      assertEquals(await answersEquivalent(ORIGINAL, CANDIDATE), false);
    });
  }
});

Deno.test("reword: sends the grounded answer as untrusted data to configured Groq", async () => {
  await withGroq(
    "groq-test",
    groqReply(JSON.stringify({ reply: CANDIDATE })),
    async (calls) => {
      assertEquals(await rewordAnswer(ORIGINAL), CANDIDATE);
      assertEquals(calls.length, 1);
      assertEquals(new URL(calls[0].url).hostname, "api.groq.com");
      assertEquals(calls[0].body.model, "test-gate-model");
      assertEquals(calls[0].body.temperature, 0);
      assertEquals(calls[0].body.response_format, { type: "json_object" });
      assertEquals(calls[0].signal instanceof AbortSignal, true);
      const messages = calls[0].body.messages as {
        role: string;
        content: string;
      }[];
      assertEquals(messages.map((message) => message.role), ["system", "user"]);
      assertEquals(messages[0].content, REWORD_SYSTEM_PROMPT);
      assertEquals(messages[0].content.includes(ORIGINAL), false);
      assertStringIncludes(messages[0].content, "warnings");
      assertStringIncludes(messages[0].content, "units");
      assertEquals(JSON.parse(messages[1].content), { original: ORIGINAL });
    },
  );
});

Deno.test("reword: rejects unchanged wording and missing credentials", async () => {
  await withGroq(
    "groq-test",
    groqReply(JSON.stringify({ reply: ORIGINAL })),
    async () => {
      assertEquals(await rewordAnswer(ORIGINAL), null);
    },
  );
  await withGroq(
    undefined,
    groqReply(JSON.stringify({ reply: CANDIDATE })),
    async (calls) => {
      assertEquals(await rewordAnswer(ORIGINAL), null);
      assertEquals(calls.length, 0);
    },
  );
});

Deno.test("reword: a dedicated general-chat key overrides the shared gate key", async () => {
  const previous = Deno.env.get("GENERAL_CHAT_VARIATION_GROQ_API_KEY");
  Deno.env.set("GENERAL_CHAT_VARIATION_GROQ_API_KEY", "variation-test");
  try {
    await withGroq(
      undefined,
      groqReply(JSON.stringify({ reply: CANDIDATE })),
      async (calls) => {
        assertEquals(await rewordAnswer(ORIGINAL), CANDIDATE);
        assertEquals(calls[0].authorization, "Bearer variation-test");
      },
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GENERAL_CHAT_VARIATION_GROQ_API_KEY");
    } else Deno.env.set("GENERAL_CHAT_VARIATION_GROQ_API_KEY", previous);
  }
});

Deno.test("reword: provider errors and malformed replies fail closed", async () => {
  for (
    const reply of [
      new Response("busy", { status: 503 }),
      groqReply(""),
      groqReply("not json"),
      groqReply('{"reply":42}'),
      groqReply('{"reply":"  "}'),
      new Error("timeout"),
    ]
  ) {
    await withGroq("groq-test", reply, async () => {
      assertEquals(await rewordAnswer(ORIGINAL), null);
    });
  }
});
