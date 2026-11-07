// Run with: deno test --allow-read tests/advice_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { splitAdvice } from "../frontend/src/lib/advice.ts";

Deno.test("advice: referral sentences are marked, the rest are not", () => {
  const reply =
    "Taking ibuprofen every day is not recommended. NSAIDs can reduce blood flow to the kidneys. " +
    "A doctor can help figure out the safest choice for managing your pain based on your overall health.";
  const parts = splitAdvice(reply);
  assertEquals(parts.map((p) => p.advice), [false, false, true]);
  // Joining the parts gives back the reply exactly.
  assertEquals(parts.map((p) => p.text).join(""), reply);
});

Deno.test("advice: each referral wording is recognised", () => {
  for (
    const s of [
      "Please talk to your health care team.",
      "Ask your pharmacist about it.",
      "Visit your nearest health center.",
      "Consult a qualified health professional.",
      "This needs emergency care right away.",
      "Seek medical attention.",
      "Your healthcare provider can explain more.",
    ]
  ) {
    assertEquals(splitAdvice(s)[0].advice, true, s);
  }
});

Deno.test("advice: ordinary content is not marked", () => {
  for (
    const s of [
      "Chronic kidney disease means the kidneys are damaged.",
      "High blood pressure usually has no symptoms.",
      "Statins lower LDL cholesterol.",
    ]
  ) {
    assertEquals(splitAdvice(s)[0].advice, false, s);
  }
});

Deno.test("advice: paragraph breaks are preserved", () => {
  const reply = "First paragraph.\n\nTalk to your doctor.";
  assertEquals(splitAdvice(reply).map((p) => p.text).join(""), reply);
});
