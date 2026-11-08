// Run with: deno test --allow-read tests/emergency_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { EMERGENCY_REPLY, isEmergency } from "../supabase/functions/_shared/emergency.ts";

Deno.test("emergency: first-person emergency descriptions are caught", () => {
  for (
    const m of [
      "I have severe chest pain, but I think it's just my kidney disease. What should I do?",
      "My chest hurts and my arm is numb",
      "I can't breathe properly",
      "I haven't peed since yesterday",
      "I can't urinate at all",
      "My dad fainted and I don't know what to do",
      "I'm coughing blood",
      "Masakit ang dibdib ko",
      "Hirap akong huminga",
      "Dili ko makaihi",
      "I want to kill myself",
    ]
  ) {
    assertEquals(isEmergency(m), true, m);
  }
});

Deno.test("emergency: general questions go through the normal pipeline", () => {
  for (
    const m of [
      "Is chest pain a symptom of CKD?",
      "What are the warning signs of a heart attack?",
      "What causes shortness of breath in kidney failure?",
      "Why do people with kidney failure stop urinating?",
      "My feet are swollen, and my urine is foamy. Do I have CKD?",
      "I have diabetes. Does that mean I have kidney disease?",
    ]
  ) {
    assertEquals(isEmergency(m), false, m);
  }
});

Deno.test("emergency: the reply sends the person to emergency care", () => {
  assertEquals(EMERGENCY_REPLY.includes("911"), true);
  assertEquals(EMERGENCY_REPLY.includes("emergency room"), true);
});
