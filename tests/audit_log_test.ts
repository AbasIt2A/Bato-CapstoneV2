// Unit tests for the chatbot safety audit log (_shared/audit-log.ts).
// Run with: deno test --allow-read --allow-env tests/audit_log_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  auditOutcome,
  withChatAudit,
} from "../supabase/functions/_shared/audit-log.ts";

const SERVICE_ERROR = "The service is having trouble.";

function stubClient(insertError: { message: string } | null = null) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return Promise.resolve({ error: insertError });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts };
}

function post(body: unknown): Request {
  return new Request("http://local/fn", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function reply(body: unknown, status = 200) {
  return () => Promise.resolve(Response.json(body, { status }));
}

const options = (client: SupabaseClient) => ({
  supabase: () => client,
  scope: "general_education" as const,
  questionField: "message",
  serviceErrorMessage: SERVICE_ERROR,
});

Deno.test("audit: outcome separates answers, deflections and service errors", () => {
  assertEquals(auditOutcome({ reply: "CKD is…", deflected: false }, SERVICE_ERROR), "answered");
  assertEquals(auditOutcome({ reply: "I can only…", deflected: true }, SERVICE_ERROR), "deflected");
  assertEquals(auditOutcome({ reply: SERVICE_ERROR, deflected: true }, SERVICE_ERROR), "service_error");
});

Deno.test("audit: records the question, the served reply and its sources", async () => {
  const { client, inserts } = stubClient();
  const sources = [{ source: "NIDDK", title: "t", heading_path: null }];
  const res = await withChatAudit(
    post({ message: "  what is ckd  ", history: [] }),
    options(client),
    reply({ reply: "CKD is a long-term condition.", sources, deflected: false }),
  );
  // The participant still receives the body unchanged.
  assertEquals((await res.json()).reply, "CKD is a long-term condition.");
  assertEquals(inserts, [{
    table: "chat_audit_log",
    scope: "general_education",
    question: "what is ckd",
    reply: "CKD is a long-term condition.",
    sources,
    outcome: "answered",
    participant_code: null,
  }]);
});

Deno.test("audit: no user or session identifier is ever stored", async () => {
  const { client, inserts } = stubClient();
  await withChatAudit(
    post({ message: "q", userId: "u-1", sessionId: "s-1" }),
    options(client),
    reply({ reply: "r", sources: [], deflected: true }),
  );
  assertEquals(
    Object.keys(inserts[0]).sort(),
    ["outcome", "participant_code", "question", "reply", "scope", "sources", "table"],
  );
});

Deno.test("audit: personal details are filtered before the row is written", async () => {
  const { client, inserts } = stubClient();
  await withChatAudit(
    post({ message: "My name is Ana Reyes, call 09171234567. Is my eGFR of 45 bad?" }),
    options(client),
    reply({ reply: "r", sources: [], deflected: false }),
  );
  assertEquals(
    inserts[0].question,
    "My name is [name removed], call [phone number removed]. Is my eGFR of 45 bad?",
  );
});

Deno.test("audit: a valid participant code is stored, normalised", async () => {
  const { client, inserts } = stubClient();
  await withChatAudit(
    post({ message: "q", participantCode: " p07 " }),
    options(client),
    reply({ reply: "r", sources: [], deflected: false }),
  );
  assertEquals(inserts[0].participant_code, "P07");
});

Deno.test("audit: anything but P plus digits is stored as null", async () => {
  for (const participantCode of ["Juan dela Cruz", "P", "P12345", "X07", "P07; drop table", 7, null]) {
    const { client, inserts } = stubClient();
    await withChatAudit(
      post({ message: "q", participantCode }),
      options(client),
      reply({ reply: "r", sources: [], deflected: false }),
    );
    assertEquals(inserts[0].participant_code, null, `accepted ${JSON.stringify(participantCode)}`);
  }
});

Deno.test("audit: error responses and non-POST requests are not recorded", async () => {
  const { client, inserts } = stubClient();
  await withChatAudit(post({ message: "q" }), options(client), reply({ error: "bad" }, 400));
  await withChatAudit(
    new Request("http://local/fn", { method: "OPTIONS" }),
    options(client),
    () => Promise.resolve(new Response("ok")),
  );
  assertEquals(inserts.length, 0);
});

Deno.test("audit: a failed insert never changes the participant's response", async () => {
  const { client } = stubClient({ message: "relation does not exist" });
  const res = await withChatAudit(
    post({ message: "q" }),
    options(client),
    reply({ reply: "r", sources: [], deflected: false }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reply, "r");
});

Deno.test("audit: CHAT_AUDIT_LOG_ENABLED=false stops recording", async () => {
  Deno.env.set("CHAT_AUDIT_LOG_ENABLED", "false");
  try {
    const { client, inserts } = stubClient();
    await withChatAudit(post({ message: "q" }), options(client), reply({ reply: "r", sources: [], deflected: false }));
    assertEquals(inserts.length, 0);
  } finally {
    Deno.env.delete("CHAT_AUDIT_LOG_ENABLED");
  }
});

Deno.test("audit: a session with no participant code still logs, with a null code", async () => {
  const { client, inserts } = stubClient();
  await withChatAudit(
    post({ message: "what is egfr", history: [] }),
    options(client),
    reply({ reply: "r", sources: [], deflected: false }),
  );
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].participant_code, null);
});

// The participant code is for withdrawal only. It must never reach the gate,
// the answer cache, or Gemini, Groq or Cohere, so no Edge Function code other
// than the audit-log wrapper may read it. Comments are stripped first: the
// request-shape comments in general-chat and clarify name the field.
Deno.test("audit: only the audit-log wrapper reads the participant code", async () => {
  const root = new URL("../supabase/functions/", import.meta.url);
  const readers: string[] = [];
  const walk = async (dir: URL) => {
    for await (const entry of Deno.readDir(dir)) {
      const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
      if (entry.isDirectory) await walk(url);
      else if (entry.name.endsWith(".ts")) {
        const code = (await Deno.readTextFile(url))
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (/participant_?code/i.test(code)) readers.push(url.pathname.split("/functions/")[1]);
      }
    }
  };
  await walk(root);
  assertEquals(readers, ["_shared/audit-log.ts"]);
});
