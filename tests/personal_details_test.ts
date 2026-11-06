// Personal-details filter tests (_shared/personal-details.ts and its browser
// mirror, frontend/src/lib/personal-details.ts).
// Run with: deno test --allow-read --allow-env tests/personal_details_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import {
  PLACEHOLDERS,
  redactPersonalDetails as redact,
} from "../supabase/functions/_shared/personal-details.ts";
import { PARTICIPANT_CODE_PATTERN } from "../supabase/functions/_shared/audit-log.ts";

const { email, phone, id, name, address, birthDate } = PLACEHOLDERS;

Deno.test("personal details: browser copy is identical to the server copy", async () => {
  const read = (path: string) =>
    Deno.readTextFile(new URL(path, import.meta.url)).then((s) => s.replace(/\r\n/g, "\n"));
  assertEquals(
    await read("../frontend/src/lib/personal-details.ts"),
    await read("../supabase/functions/_shared/personal-details.ts"),
    "frontend/src/lib/personal-details.ts has drifted — copy the server file over it",
  );
});

// Read as text: participant-code.ts uses browser globals Deno cannot type.
Deno.test("participant code: browser and server accept the same format", async () => {
  const client = await Deno.readTextFile(
    new URL("../frontend/src/lib/participant-code.ts", import.meta.url),
  );
  const declared = /PARTICIPANT_CODE_PATTERN = \/(.+)\/;/.exec(client)?.[1];
  assertEquals(declared, PARTICIPANT_CODE_PATTERN.source);
});

Deno.test("personal details: phone numbers", () => {
  assertEquals(redact("call 09171234567"), `call ${phone}`);
  assertEquals(redact("call 0917 123 4567"), `call ${phone}`);
  assertEquals(redact("call +63 917 123 4567"), `call ${phone}`);
  assertEquals(redact("call (082) 234-5678"), `call ${phone}`);
  assertEquals(redact("call 234-5678"), `call ${phone}`);
});

Deno.test("personal details: email addresses", () => {
  assertEquals(redact("email juan.dc+bato@gmail.com please"), `email ${email} please`);
});

Deno.test("personal details: ID-like numbers", () => {
  assertEquals(redact("PhilHealth 12-345678901-2"), `PhilHealth ${id}`);
  assertEquals(redact("SSS 34-1234567-8"), `SSS ${id}`);
  assertEquals(redact("TIN 123-456-789-000"), `TIN ${id}`);
  assertEquals(redact("licence N01-12-345678"), `licence ${id}`);
  assertEquals(redact("passport P1234567A"), `passport ${id}`);
});

Deno.test("personal details: names after a cue, in all three languages", () => {
  assertEquals(
    redact("My name is Juan dela Cruz and I have diabetes."),
    `My name is ${name} and I have diabetes.`,
  );
  assertEquals(redact("my name is maria, 54 years old"), `my name is ${name}, 54 years old`);
  assertEquals(redact("Ako si Ana Reyes, may hypertension ako"), `Ako si ${name}, may hypertension ako`);
  assertEquals(redact("Ang pangalan ko ay Jose Rizal"), `Ang pangalan ko ay ${name}`);
  assertEquals(
    redact("Akong ngalan kay Pedro Santos ug naa koy diabetes"),
    `Akong ngalan kay ${name} ug naa koy diabetes`,
  );
  assertEquals(redact("Dr. Santos said my eGFR is 45"), `Dr. ${name} said my eGFR is 45`);
});

Deno.test("personal details: addresses", () => {
  assertEquals(
    redact("I live in Davao City, where can I get tested?"),
    `I live in ${address}, where can I get tested?`,
  );
  assertEquals(
    redact("I live at 123 Rizal St., Brgy. Buhangin, Davao City"),
    `I live at ${address}, ${address}, Davao City`,
  );
  assertEquals(redact("Nakatira ako sa Purok 5 Blk 3 Lot 12, Toril"), `Nakatira ako sa ${address}, Toril`);
  assertEquals(redact("near Barangay Matina Crossing"), `near ${address}`);
});

Deno.test("personal details: birth dates after a cue, in all three languages", () => {
  assertEquals(redact("I was born on May 12, 1965. Am I at risk?"), `I was born on ${birthDate}. Am I at risk?`);
  assertEquals(redact("born 12 May 1965"), `born ${birthDate}`);
  assertEquals(redact("My birthday is 05/12/1965"), `My birthday is ${birthDate}`);
  assertEquals(redact("DOB: 1965-05-12, BP 140/90"), `DOB: ${birthDate}, BP 140/90`);
  assertEquals(redact("date of birth March 3rd"), `date of birth ${birthDate}`);
  assertEquals(redact("born in May 1965"), `born in ${birthDate}`);
  assertEquals(redact("Ipinanganak ako noong ika-12 ng Mayo 1965"), `Ipinanganak ako noong ${birthDate}`);
  assertEquals(redact("Ang kaarawan ko ay Hunyo 5"), `Ang kaarawan ko ay ${birthDate}`);
  assertEquals(redact("Natawo ko niadtong Mayo 12, 1965"), `Natawo ko niadtong ${birthDate}`);
});

Deno.test("personal details: birth years and other dates are kept", () => {
  for (
    const text of [
      "I was born in 1965, which age group am I?",
      "I was born with one kidney",
      "My lab test was on May 12, 1965", // a date with no birth cue
      "My appointment is on 05/12/2026",
      "May 12 pa ang check-up ko",
    ]
  ) {
    assertEquals(redact(text), text);
  }
});

Deno.test("personal details: clinical content is left alone", () => {
  for (
    const text of [
      "What is CKD stage 3 and eGFR below 60?",
      "I am 54 years old, BP 140/90, creatinine 1.2 mg/dL",
      "I was diagnosed on 2023-05-01.",
      "Is a phase 3 trial available?",
      "COVID-19 and kidneys",
      "Where is the barangay health center? Is the Barangay Health Station free?",
      "Does PhilHealth cover dialysis?",
      "Can I take vitamin B12 and 500 mg paracetamol?",
      "I'm worried about my kidneys",
    ]
  ) {
    assertEquals(redact(text), text);
  }
});

Deno.test("personal details: filtering is idempotent", () => {
  const once = redact(
    "My name is Ana, born on May 12, 1965, call 09171234567 or ana@x.com, I live at 12 Mabini St, ID P1234567A",
  );
  assertEquals(redact(once), once);
});
