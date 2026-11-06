// Decides whether free text typed during the screening is a QUESTION for the
// clarification assistant or an ANSWER for the screening controller.
//
// ===== DEFAULT TO QUESTION =====
//
// The first version listed question shapes and treated everything else as an
// answer, so any phrasing it had not anticipated — "provide symptions of
// anemia" — was submitted as an answer and bounced back as "Please answer yes
// or no". However long that list grows, it can always miss one.
//
// The set of ANSWERS, by contrast, is small and closed: yes/no in three
// languages, a sex, an age, and the not-sure phrasings. So the decision is
// made in three steps, and only the middle one can make text an answer:
//
//   1. a clear question signal anywhere          → question
//      ("?" at the end, an interrogative or request word, "symptoms",
//       "don't understand", "heard of", a Tagalog/Bisaya "ba"...)
//   2. it looks like an answer                   → answer
//      (opens with yes/no/sex/unsure/"I ..." wording, holds an age, or is a
//       short typo-length token like "yse")
//   3. anything else                             → question
//
// Step 1 runs first so "I don't know what anemia is" or "no, what does that
// mean?" reach the assistant even though they open like answers. Step 2
// sends answer-shaped text — including a malformed answer like "yes I was
// diagnosed in 2019" — to the controller, which replies with its own
// validation message; that is the right place for it.
//
// tests/question_shape_test.ts pins both sides: every answer the controller
// accepts must stay an answer, and a broad battery of questions must not.
//
// Pure, no imports: the Deno test suite imports it directly.

// ---------------------------------------------------------------------------
// Step 1 — question signals
// ---------------------------------------------------------------------------

/** Words that open a question or request (English, Tagalog, Bisaya). */
const OPENERS = [
  // Interrogatives and auxiliaries.
  "what", "whats", "what's", "why", "how", "which", "who", "whom", "whose",
  "when", "where", "does", "did", "is", "are", "should", "would",
  // "do", but not "do not know" — an answer.
  "do(?!\\s+not\\b)",
  "could", "will", "shall",
  // NOT "have", "has", "was", "were", "may": they open answers — "was told
  // yes", and Tagalog "may anemia ako" ("I have anemia").
  // "can", but not "can't remember" / "cannot recall" — those are answers.
  "can(?!'|’|not\\b|t\\b)",
  // Requests.
  "explain", "define", "definition", "meaning", "provide", "give", "tell",
  "list", "show", "describe", "please", "pls", "plz", "help", "clarify",
  "elaborate", "simplify", "rephrase", "repeat", "share", "teach",
  "enumerate", "mention", "identify",
  "i\\s+(?:want|wanna|need|would\\s+like|'d\\s+like|wish)\\s+to\\s+(?:know|ask|understand|learn)",
  "i\\s+(?:have|got)\\s+a\\s+question", "question", "quick\\s+question",
  "may\\s+i\\s+ask", "let\\s+me\\s+ask",
  // Tagalog.
  "ano", "anong", "anu", "bakit", "paano", "pano", "alin", "sino", "kailan",
  "saan", "gaano", "ilan", "ipaliwanag", "pakipaliwanag", "paliwanag",
  "sabihin", "sabihin\\s+mo", "pakisabi", "ilista", "ibigay", "magbigay",
  "tanong", "patanong", "pwede", "puwede", "maaari",
  // Bisaya.
  "unsa", "unsay", "unsaon", "ngano", "nganong", "giunsa", "asa", "kinsa",
  "kanus-a", "pila", "isulti", "ihatag", "ipasabot", "ipatin-aw", "pangutana",
  "mahimo",
];

const OPENER = new RegExp(`^(?:${OPENERS.join("|")})\\b`, "i");

/** Words that make a message a question wherever they appear. */
const ANYWHERE = new RegExp(
  [
    // Interrogatives mid-sentence: "not sure what anemia is".
    String.raw`\b(?:what|why|how|which)\b`,
    // Symptoms and signs; "sympt\w*" also catches "symptions", "symtoms" via
    // the second form.
    String.raw`\bsympt\w*`,
    String.raw`\bsymt\w*`,
    String.raw`\bsigns?\s+(?:of|and)\b`,
    String.raw`\bwarning\s+signs?\b`,
    // Asking for meaning or help.
    String.raw`\b(?:meaning|means\s+what|definition|define|explain\w*|clarif\w*|elaborat\w*)\b`,
    String.raw`\b(?:understand|familiar|confus\w*|unclear|heard\s+(?:of|about))\b`,
    String.raw`\b(?:tell|show|teach|give)\s+me\b`,
    String.raw`\b(?:more\s+(?:about|info)|information\s+(?:about|on)|learn\s+about)\b`,
    String.raw`\b(?:help|question|ask)\b`,
    // Tagalog / Bisaya question words and particles mid-sentence.
    String.raw`\b(?:ano|anong|bakit|paano|pano|unsa|unsay|ngano|giunsa|kahulugan|ibig\s+sabihin|ipasabot|buot\s+ipasabot)\b`,
    String.raw`\b(?:maintindihan|naiintindihan|intindi|kasabot|nakasabot|sabtan)\b`,
    String.raw`\b(?:sintomas|senyales|palatandaan|timailhan|ilhanan)\b`,
    // The question particle "ba": "meron ba", "diabetes ba".
    String.raw`\bba\b`,
  ].join("|"),
  "i",
);

// ---------------------------------------------------------------------------
// Step 2 — answer shapes
// ---------------------------------------------------------------------------

/** Words an answer opens with. */
const ANSWER_OPENERS = [
  // Yes.
  "yes", "yess+", "yeah", "yea", "yep", "yup", "ya", "ye", "y", "sure",
  "of\\s+course", "definitely", "certainly", "correct", "right", "true",
  "ok", "okay", "affirmative", "already",
  // No.
  "no+", "nope", "nah", "n", "never", "none", "nothing", "not", "negative",
  "false",
  // Tagalog / Bisaya yes, no, maybe.
  "oo", "opo", "oho", "syempre", "siyempre", "sige", "meron", "mayroon",
  "naa", "hindi", "di", "wala", "wa", "dili", "ambot", "siguro", "baka",
  "basin", "tingali",
  // Unsure.
  "maybe", "perhaps", "probably", "possibly", "unsure", "idk", "dunno",
  "forgot", "forget", "can'?t", "can’t", "cannot", "can\\s+not", "don'?t",
  "don’t", "do\\s+not", "didn'?t", "haven'?t", "hasn'?t", "wasn'?t",
  "doubt",
  // Sex.
  "female", "f", "male", "m", "woman", "women", "girl", "lady", "man", "boy",
  "guy", "babae", "babaye", "lalaki", "lalake",
  // First-person statements: "I have...", "I'm 54", "my doctor said yes".
  "i", "i'm", "im", "i’m", "i've", "ive", "me", "my", "mine", "ako", "ko",
  "akoa", "ang\\s+edad\\s+ko",
  // Statements with the subject dropped: "had a stroke", "was told no",
  // Tagalog "may anemia ako".
  "had", "have", "has", "was", "were", "been", "diagnosed", "told", "may",
];

const ANSWER_OPENER = new RegExp(`^(?:${ANSWER_OPENERS.join("|")})\\b`, "i");

/** An age, in digits or in English / Tagalog / Bisaya number words. */
const AGE = new RegExp(
  [
    String.raw`\d`,
    String.raw`\b(?:twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)\b`,
    // Tagalog tens: dalawampu, tatlumpu, apatnapu, limampu, animnapu,
    // pitumpu, walumpu, siyamnapu.
    String.raw`\b(?:dalawampu|tatlumpu|apatnapu|limampu|animnapu|pitumpu|walumpu|siyamnapu)\w*`,
    // Bisaya tens: kawhaan, katloan, kap-atan, kalim-an, kan-uman, kapitoan,
    // kawaloan, kasiyaman.
    String.raw`\b(?:kawhaan|katloan|kap-?atan|kalim-?an|kan-?uman|kapitoan|kawaloan|kasiyaman)\b`,
    String.raw`\byears?\s+old\b`,
    String.raw`\btaon\b`,
    String.raw`\bedad\b`,
  ].join("|"),
  "i",
);

/**
 * Screening terms short enough to look like a typo'd answer. A bare one of
 * these is asking for a definition, not answering.
 */
const SHORT_TERMS = new Set([
  "pvd", "cvd", "chf", "ckd", "bp", "hbp", "htn", "dm", "gfr", "egfr", "acr",
  "uacr", "uti", "aki", "esrd", "bato",
]);

function looksLikeAnswer(t: string): boolean {
  if (ANSWER_OPENER.test(t)) return true;
  if (AGE.test(t)) return true;
  // A single short token — "yse", "noo", "hmm", "k" — is far likelier a
  // fumbled answer than a question; the controller's validation message is
  // the better reply. Known abbreviations are the exception.
  const words = t.split(/\s+/);
  return words.length === 1 && t.length <= 4 &&
    !SHORT_TERMS.has(t.toLowerCase());
}

// ---------------------------------------------------------------------------

/** Trailing punctuation and emphasis that never change the decision. */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/^["'“‘(\s]+/, "")
    .replace(/[\s.!,;:…"'”’)]+$/, "")
    .replace(/\s+/g, " ");
}

/**
 * "yes?", "no po?", "54?" — a one- or two-word answer with a stray question
 * mark is still an answer. Longer text ending in "?" is a question.
 */
function isAnswerWithStrayQuestionMark(t: string): boolean {
  if (!/\?$/.test(t)) return false;
  const bare = t.replace(/\?+$/, "").trim();
  return bare.split(/\s+/).length <= 2 && !OPENER.test(bare) &&
    !ANYWHERE.test(bare) && looksLikeAnswer(bare);
}

export function isQuestionShaped(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  if (isAnswerWithStrayQuestionMark(t)) return false;

  // Step 1 — a clear question signal wins over everything.
  if (/\?\s*$/.test(t) || OPENER.test(t) || ANYWHERE.test(t)) return true;

  // Step 2 — answer-shaped text goes to the controller.
  if (looksLikeAnswer(t)) return false;

  // Step 3 — anything else is treated as a question. Sending an unclear
  // message to the assistant costs one explanation; sending a question to
  // the controller as an answer is the failure this file exists to prevent.
  return true;
}
