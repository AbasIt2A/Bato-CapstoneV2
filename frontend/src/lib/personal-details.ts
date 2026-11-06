// Personal-details filter (UIC-REC protocol UG-ER-09-26-0744).
//
// Replaces phone numbers, email addresses, ID-like numbers, birth dates, and
// names and street addresses where a pattern can detect them, with a
// bracketed placeholder. Runs on participant text before it goes anywhere:
//
//   * in the browser, before a chat request is sent (so the transcript and
//     the conversation history carry the filtered text too);
//   * in the Edge Functions, before the gate, the answer cache, Gemini,
//     Groq or Cohere see the text — the browser copy is a courtesy, not a
//     guarantee, since any client can skip it;
//   * in the audit-log wrapper, immediately before the row is written, so
//     chat_audit_log only ever holds filtered text.
//
// Pattern-based, so it is a safety net, not a guarantee: a name typed with no
// cue ("Juan says his kidneys hurt") is not detected. The consent screen
// still asks participants not to type identifying details.
//
// Deliberately left alone: ages, lab values, blood pressure readings and
// dates. They carry the clinical meaning of most questions, and none of them
// identifies a person on its own. The one exception is a birth date: a date
// introduced by "born on", "my birthday is", "date of birth" (or the Filipino
// and Cebuano forms) is removed, since with the participant code and the
// session time it narrows a row to one person. A birth year on its own is
// kept — it says no more than an age does.
//
// ===== TWO COPIES =====
//
// This file is mirrored byte for byte at frontend/src/lib/personal-details.ts
// (the frontend cannot import Deno modules from supabase/functions/).
// tests/personal_details_test.ts fails if the two differ — edit one, copy it
// over the other.
//
// redactPersonalDetails() is idempotent: placeholders never match a pattern,
// so filtering already-filtered text changes nothing.

export const PLACEHOLDERS = {
  email: "[email removed]",
  phone: "[phone number removed]",
  id: "[ID number removed]",
  name: "[name removed]",
  address: "[address removed]",
  birthDate: "[birth date removed]",
} as const;

// English, Filipino and Cebuano month names and abbreviations. The
// lookahead stops "May" matching the start of "Mayo".
const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?" +
  "|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|pebrero|marso" +
  "|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)(?!\\p{L})\\.?";

// A date with at least a day or a month: 05/12/1990, 1990-05-12, 05/1990,
// May 12(, 1990), 12 May 1990, ika-12 ng Mayo, May 1990. A bare year is not
// one (see header).
const BIRTH_DATE_VALUE =
  "(?:\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{1,2}[/.-]\\d{4}" +
  `|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+\\d{4})?` +
  `|(?:ika-?)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:(?:of|ng|sa)\\s+)?${MONTH}(?:,?\\s+\\d{4})?` +
  `|${MONTH},?\\s+\\d{4})(?!\\d)`;

// The cue, then any of a few filler words ("is", "on", "ko", "noong"…),
// then the date. Only the date is replaced.
const BIRTH_DATE = new RegExp(
  "(\\b(?:" +
    [
      "born",
      "birth\\s*day",
      "birth\\s*date",
      "date\\s+of\\s+birth",
      "d\\.?o\\.?b\\.?",
      "kaarawan",
      "ipinanganak",
      "isinilang",
      "natawo",
      "adlaw(?:\\s+(?:sa|nga)\\s+|ng\\s+)natawhan",
    ].join("|") +
    ")(?:[\\s:,-]+(?:is|was|on|in|ay|ko|ako|po|noong|nung|sa|kay|nako|niadtong|ang)(?!\\p{L}))*[\\s:,-]*)" +
    BIRTH_DATE_VALUE,
  "giu",
);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// A token mixing letters with six or more digits: driver's licence, passport
// and most printed card numbers ("N01-12-345678", "P1234567A").
const ALPHANUMERIC_ID =
  /(?<![\w-])(?=[A-Za-z0-9-]*[A-Za-z])(?=(?:[A-Za-z-]*\d){6})[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?![\w-])/g;

// Seven or more digits, optionally grouped by single spaces, dots or dashes,
// with an optional "+" or bracketed area code: phone numbers and numeric IDs
// (SSS, TIN, PhilHealth, PRC). Blood pressure ("140/90") and lab values
// ("1.2") never reach seven digits.
const DIGIT_RUN =
  /(?<![\w.-])(?:\+\s?)?(?:\(\d{2,4}\)\s?)?\d(?:[ .-]?\d){6,}(?![\w])/g;

// 1990-05-12, 12.05.1990 — dates are left alone (see header).
const DATE_SHAPE = /^(?:\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/;

// Philippine mobile (09XX…, +63 9XX…) and landline (02/0XX + 7–8 digits)
// formats, or any short local number. Everything else is an ID number.
function looksLikePhone(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  if (/^[+(]/.test(match.trim())) return true;
  if (/^(?:63|0)?9\d{9}$/.test(digits)) return true;
  if (/^0\d{9,10}$/.test(digits)) return true;
  return digits.length <= 8;
}

// "my name is …" and its Filipino and Cebuano forms. The name itself is the
// words that follow, read by takeNameWords().
const NAME_CUE = new RegExp(
  "\\b(?:" +
    [
      "my\\s+(?:full\\s+)?name\\s+is",
      "my\\s+name's",
      "name\\s*:",
      "i\\s+am\\s+called",
      "ako\\s+(?:po\\s+)?(?:si|c)",
      "(?:ang\\s+)?pangalan\\s+ko(?:\\s+po)?(?:\\s+(?:ay\\s+si|ay|si))?",
      "(?:ang\\s+)?akong\\s+ngalan(?:\\s+(?:kay|ay|si))?",
      "ngalan\\s+nako(?:\\s+(?:kay|ay|si))?",
    ].join("|") +
    ")\\s*",
  "giu",
);

// Mr. Santos, Dra. Cruz — the following words must be capitalised.
const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Engr)\.?\s+(?=\p{Lu})/gu;

// Words that end a name: conjunctions and pronouns in English, Filipino and
// Cebuano, so "my name is Ana and I have diabetes" keeps "and I have…".
const NAME_STOP_WORDS = new Set([
  "and", "but", "or", "i", "im", "i'm", "from", "at", "ug", "pero", "o",
  "ako", "ko", "po", "na", "ang", "sa", "taga", "kasi", "because", "with",
  "my", "is", "am", "age", "aged", "years", "year", "old",
]);

// Lowercase particles inside Filipino surnames (Juan dela Cruz).
const NAME_PARTICLES = new Set(["de", "del", "dela", "delos", "los", "san", "sta", "sto"]);

const NAME_WORD = /^\p{L}[\p{L}'.-]*/u;
const MAX_NAME_WORDS = 4;

/**
 * Reads up to MAX_NAME_WORDS name words starting at `from`. Returns the end
 * offset of the last word taken, or `from` when nothing qualified.
 */
function takeNameWords(text: string, from: number, capitalisedOnly: boolean): number {
  let end = from;
  let pos = from;
  for (let taken = 0; taken < MAX_NAME_WORDS; taken++) {
    const word = NAME_WORD.exec(text.slice(pos))?.[0];
    if (!word) break;
    const lower = word.toLowerCase().replace(/\.$/, "");
    if (NAME_STOP_WORDS.has(lower)) break;
    if (capitalisedOnly && !/^\p{Lu}/u.test(word) && !NAME_PARTICLES.has(lower)) {
      break;
    }
    end = pos + word.length;
    const gap = /^ +/.exec(text.slice(end))?.[0];
    if (!gap || gap.length > 1) break;
    pos = end + gap.length;
  }
  return end;
}

function redactNamesAfter(text: string, cue: RegExp, capitalisedOnly: boolean): string {
  let out = "";
  let last = 0;
  cue.lastIndex = 0;
  for (let m = cue.exec(text); m; m = cue.exec(text)) {
    const start = m.index + m[0].length;
    const end = takeNameWords(text, start, capitalisedOnly);
    if (end === start) continue;
    out += text.slice(last, start) + PLACEHOLDERS.name;
    last = end;
    cue.lastIndex = end;
  }
  return out + text.slice(last);
}

// "I live in …" and its Filipino and Cebuano forms. The address is the rest
// of the clause, up to a comma or sentence end, capped at six words.
const ADDRESS_CUE = new RegExp(
  "\\b(?:" +
    [
      "i\\s+live\\s+(?:at|in|on)",
      "i'm\\s+living\\s+(?:at|in)",
      "i\\s+stay\\s+(?:at|in)",
      "my\\s+(?:home\\s+)?address\\s+is",
      "address\\s*:",
      "nakatira\\s+(?:po\\s+)?(?:ako|kami)(?:\\s+po)?\\s+sa",
      "address\\s+ko(?:\\s+po)?(?:\\s+ay)?",
      "nagpuyo\\s+(?:ko|ako|mi|kami)\\s+sa",
      "akong\\s+address(?:\\s+kay)?",
    ].join("|") +
    ")\\s+",
  "giu",
);
const ADDRESS_CLAUSE = /^[^,;?!\n]+?(?=[,;?!\n]|\.(?:\s|$)|$)/u;
const MAX_ADDRESS_WORDS = 6;

function redactAddressClauses(text: string): string {
  let out = "";
  let last = 0;
  ADDRESS_CUE.lastIndex = 0;
  for (let m = ADDRESS_CUE.exec(text); m; m = ADDRESS_CUE.exec(text)) {
    const start = m.index + m[0].length;
    const clause = ADDRESS_CLAUSE.exec(text.slice(start))?.[0] ?? "";
    const words = clause.split(/\s+/).filter(Boolean).slice(0, MAX_ADDRESS_WORDS);
    if (words.length === 0) continue;
    let end = start;
    for (const word of words) end = text.indexOf(word, end) + word.length;
    out += text.slice(last, start) + PLACEHOLDERS.address;
    last = end;
    ADDRESS_CUE.lastIndex = end;
  }
  return out + text.slice(last);
}

// Address parts that identify a household without any cue: barangay and
// sitio names, purok / block / lot numbers, numbered streets.
//
// Case-sensitive on purpose: the name after "Barangay" must be capitalised
// or numbered, and the barangay services participants ask about ("barangay
// health center", "Barangay Health Station") are excluded, since those
// phrases carry the question rather than an address. "Phase" is not an
// address cue here: "phase 3 trial" is far more common in this corpus.
const ADDRESS_PARTS: RegExp[] = [
  /\b(?:[Bb]rgy|[Bb]gy|[Bb]arangay|[Ss]itio)\.?\s+(?!(?:Health|Hall|Captain|Council|Tanod|Official|Officials|Clearance|Center|Centre|Station|Nutrition|Kagawad|Chairman|Worker|Workers)\b)(?:\p{Lu}[\p{L}\d'-]*|\d+[A-Za-z]?)(?:\s+\p{Lu}[\p{L}\d'-]*){0,2}/gu,
  /\b(?:Purok|Prk|Blk|Block|Lot)\.?\s*#?\d+[A-Za-z]?(?:[\s,]+(?:Purok|Prk|Blk|Block|Lot)\.?\s*#?\d+[A-Za-z]?)*/gi,
  /\b\d+[A-Za-z]?\s+(?:\p{Lu}[\p{L}'.-]*\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Lane|Highway|Hwy|Extension|Ext)\b\.?/gu,
];

/** Returns `text` with detectable personal details replaced by placeholders. */
export function redactPersonalDetails(text: string): string {
  let out = text.replace(BIRTH_DATE, (_, cue: string) => cue + PLACEHOLDERS.birthDate);
  out = out.replace(EMAIL, PLACEHOLDERS.email);
  out = out.replace(ALPHANUMERIC_ID, PLACEHOLDERS.id);
  out = out.replace(DIGIT_RUN, (match) => {
    if (DATE_SHAPE.test(match)) return match;
    return looksLikePhone(match) ? PLACEHOLDERS.phone : PLACEHOLDERS.id;
  });
  out = redactAddressClauses(out);
  for (const part of ADDRESS_PARTS) out = out.replace(part, PLACEHOLDERS.address);
  out = redactNamesAfter(out, NAME_CUE, false);
  out = redactNamesAfter(out, HONORIFIC, true);
  return out;
}
