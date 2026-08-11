# BATO Hardened RAG — Setup Guide

This guide takes you from "the code is on my machine" to "I can ask the chatbot a
CKD question and get a cited answer." It is written for Windows 10 + PowerShell,
and it assumes you have never worked with embeddings, vector databases, or
Supabase Edge Functions before. Every new term is explained the first time it
appears, and there is a glossary at the end.

---

## 1. What you're setting up

**RAG** stands for *Retrieval-Augmented Generation*. Instead of hoping an AI
model "just knows" the right answer, a RAG system first **retrieves** trusted
reference text, then makes the model answer **only from that text**. In this
project, the trusted text is the set of markdown files in `knowledge/` — curated
CKD (chronic kidney disease) information from approved sources like DOH, WHO,
CDC, NIDDK, and KDIGO.

Here is how the pieces fit. An **ingestion** script splits each knowledge file
into small sections called **chunks** (about 21 chunks across 8 files). Each
chunk is converted into an **embedding** — a list of 768 numbers (a *vector*)
that captures the chunk's meaning, produced by Google's Gemini embedding model.
Those vectors are stored in a Postgres database using the **pgvector** extension,
which can find "chunks whose meaning is closest to this question" very fast.

At question time, a small server program (a Supabase **Edge Function**) runs the
pipeline: a **gate** first checks the question is actually about kidney health
and is not a prompt-injection attempt. If it passes, the question is embedded
too, the most similar chunks are retrieved, a **reranker** re-orders them by
true relevance, and Gemini writes an answer using ONLY those chunks — citing the
source of every claim. If the question is off-topic, or nothing relevant is
found, the bot returns a polite **deflection** instead of guessing.

```
knowledge/**/*.md ──chunk──> chunks ──embed──> vectors ──store──> Postgres (pgvector)

user question ──> [gate: on-topic? safe?] ──> embed ──> retrieve similar chunks
                        │ no                                     │
                        ▼                                        ▼
                   deflection                    rerank ──> answer from chunks
                                                            (with source citations)
```

Why do this instead of pasting all the CKD text into one giant prompt? Three
reasons. **Traceability** — every answer names its sources, which your panel can
verify. **Updatability** — fix a markdown file, re-run ingestion, done; no prompt
surgery. **Safety** — the gate plus the "answer only from retrieved chunks" rule
keeps the bot on-topic and makes it much harder to trick.

---

## 2. Project map

| Path | What it is |
|---|---|
| `knowledge/**/*.md` | The knowledge base: 9 curated CKD markdown files (approved sources only), filed by source category — `official-health-body/{doh,who,niddk}/`, `clinical-guidelines/kdigo/`, `peer-reviewed/` |
| `knowledge/REVIEW-FLAGS.md` | Ledger of clinical/diet numbers awaiting adviser review |
| `scripts/chunker.ts` | Splits markdown into chunks along headings |
| `scripts/ingest-knowledge.ts` | Embeds the chunks and inserts them into the database (⛔ gated) |
| `supabase/migrations/` | SQL that creates the database table and search function (⛔ gated) |
| `supabase/functions/general-chat/` | The chatbot Edge Function (the pipeline above) |
| `supabase/functions/_shared/` | Building blocks: gate, embeddings, retrieval, rerank, prompts, output guard |
| `tests/` | Deno test suite: injection battery, deflection, rerank fallback, chunker, and more |
| `frontend/` | The web app (Vite + React): home screen with both chatbots — Risk Assessment (capstone backend) and General CKD chat (this project's backend) |
| `docs/manuscript-alignment.md` | Plain-language summary for your capstone manuscript |
| `.env` | Your secret keys (already partly filled in — never commit this file) |
| `deno.json` | The `deno task ...` shortcuts used throughout this guide |

---

## 3. The safety rule you must know

The project spec (`BATO_Hardened_RAG_Prompt.md`, §3 and §8) is **checkpoint-gated**:
any step that changes a real database or deploys code must not run until a human
explicitly approves it. For you, that means getting your adviser's sign-off (or
consciously giving your own) *before* running these steps:

- **Step 5 ⛔ — apply the database migration** (creates tables in a real database)
- **Step 6 ⛔ — run the ingestion** (writes 21 embedded chunks into that database)
- **Step 7 ⛔ — deploy the chatbot function** (puts code live on the internet)

Everything else in this guide (tests, dry runs, key setup) is read-only and safe
to run any time. The ⛔ symbol marks the gated steps below.

---

## 4. Step 0: check your tools

Both tools you need are already installed. Open PowerShell and confirm:

```powershell
deno --version
node --version
```

Expected: `deno` prints a 2.x version (plus v8 and typescript lines), and `node`
prints `v24.x`. Node v24 means you can run the Supabase CLI without installing
anything, via `npx supabase <command>`.

**If `deno` says "not recognized":** Deno is installed at
`C:\Users\bonoy\.deno\bin\deno.exe` and that folder is on your PATH — but a
program only reads the PATH when it starts. If VS Code (or your terminal) was
already open when Deno was installed, it is still using the old PATH. Two fixes:

- **Permanent:** fully close and reopen VS Code (the whole app, not just the
  terminal tab). After that, `deno` works everywhere.
- **Right now, without restarting:** paste this line to reload the PATH into the
  current terminal, then try again:

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  ```

- **Fallback:** call the full path directly, e.g.
  `& "$env:USERPROFILE\.deno\bin\deno.exe" --version`.

---

## 5. Step 1: run the offline tests

```powershell
deno task test
```

Expected: **68 passed, 8 ignored**. The 8 ignored ones are live tests that need
a real database — they run later in Step 9. The 68 offline tests cover the
prompt-injection battery, scope deflection, the rerank fallback, chunking rules,
the approved-sources whitelist, and the output guard — all without any network.

---

## 6. Step 2: preview the knowledge base

```powershell
deno task ingest:dry
```

This is a **dry run**: no network, no database — it just chunks the knowledge
files and prints a stats table. Expected: **34 chunks across 9 files**, with
**5 chunks flagged**. Each file is listed by its path under `knowledge/` (e.g.
`official-health-body/who/statistics-and-burden.md`), and each table row is one
chunk: its file, heading path, and size. "Flagged" means the chunk contains diet
or clinical numbers (like eGFR thresholds or nutrient amounts) that need adviser
review before going live. All
5 flags are already tracked in `knowledge/REVIEW-FLAGS.md` — the dry run prints
them every time so a human always sees what clinical content is about to be
embedded.

---

## 7. Step 3: your API keys

Your keys live in `.env` in the project root. It already exists.

**Gemini.** `GEMINI_API_KEY` powers embeddings and answer generation. Make a
key at https://aistudio.google.com/apikey and paste it into `GEMINI_API_KEY=`.

Two things to know if you swap keys:

- **The 2.5 models are closed to new keys.** `gemini-2.5-flash` and
  `gemini-2.5-flash-lite` return HTTP 404 "no longer available to new users"
  on any recently-created key. Check what a key can actually reach with
  `deno task check:providers`, which makes a real request to every model this
  project uses. Do NOT rely on
  `GET https://generativelanguage.googleapis.com/v1beta/models` — that listing
  is optimistic and includes models the key cannot call.
- **The free tier is 20 generation requests per day, per model.** Read that
  limit carefully: it is metered *per model name*, which is why this project
  deliberately uses a different model for each role (see the quota-budget
  table in [README.md](README.md)). Two roles pointed at one model share one
  allowance.

**Groq — strongly recommended.** `GROQ_API_KEY` moves the input gate off
Gemini entirely. Make a key at https://console.groq.com/keys and paste it into
`GROQ_API_KEY=`.

This is the single highest-value line in your `.env`. The gate runs on every
message, and while it shared Gemini with answer generation, each message cost
2 of the day's 20 requests — about ten messages a day for the whole project.
Groq's free tier is orders of magnitude larger and a small model classifies
"is this about kidneys" perfectly well. Without the key nothing breaks: the
gate falls back to Gemini and you get roughly half the capacity.

**A note on how quota failure looks.** When generation quota runs out, the
gate fails open, retrieval still works, and only the final answer call fails —
so the app degrades to *"the chatbot deflects everything"* rather than showing
an error. That is indistinguishable from a scope, threshold or retrieval bug
by eye. Run `deno task check:providers` first whenever you see mass
deflection; it reports HTTP 429 as "QUOTA EXHAUSTED" explicitly.

**Cohere — optional.** Cohere powers the rerank stage (step 4 of the pipeline).
Without a key, the pipeline automatically falls back to cosine-similarity
ordering — everything still works, ranking is just slightly weaker. If you want
it: https://dashboard.cohere.com/api-keys, the free trial tier is fine, paste
into `COHERE_API_KEY=`.

What's left to fill in: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — that is
the next step.

---

## 8. Step 4: create the Supabase project (Option A, recommended)

Supabase is a hosted service that gives you a Postgres database plus a place to
run server code. The free tier is enough for this project.

1. Go to https://supabase.com and sign in (GitHub login works).
2. Click **New project** (free tier). Pick a name like `bato-rag`, choose a
   region close to the Philippines (e.g. Southeast Asia), and set a database
   password. **Save that password somewhere safe** — you may need it later and
   it is not shown again.
3. Wait a minute or two while the project provisions.
4. Open **Project Settings → Data API**. Copy the **Project URL** into
   `SUPABASE_URL=` in your `.env`, and the **`service_role` secret key** into
   `SUPABASE_SERVICE_ROLE_KEY=`.

> **What is the service role key?** It is the master key to your database — it
> bypasses every access rule. This project uses it only in server-side code
> (the ingest script and the Edge Function). It must NEVER appear in frontend
> code, in the browser, or in git. `.env` is gitignored for exactly this reason.

### ⚠️ Option B: reusing your existing capstone project — talk to your adviser first

Your capstone Supabase project (`xnbscwqawzyixeobukkt`) **already contains an
older `knowledge_chunks` table**. This project's migration creates a table with
the same name, so pointing it at the capstone project **will conflict** — the
migration will fail or, worse, you could disturb the table your existing app
uses. If you truly want one shared project, discuss it with your adviser first
and plan the migration deliberately. Otherwise, use the fresh project from
Option A — it is free and completely isolated.

---

## 9. Step 5 ⛔: apply the database migration

*Gated step — get sign-off before running (see section 3).*

A **migration** is a SQL script that sets up the database schema. Find your
project ref first: it is the short id in your project URL,
`https://<project-ref>.supabase.co`. Then, from the project folder
(`E:\BATO CHATBOT V2`):

```powershell
npx supabase login
npx supabase link --project-ref YOUR-NEW-PROJECT-REF
npx supabase db push
```

`login` opens a browser to authenticate, `link` points the CLI at your new
project (it may ask for the database password from Step 4), and `db push`
applies the migration. The migration enables the pgvector extension, creates the
`knowledge_chunks` table (with a CHECK constraint that only approved sources can
ever be stored), creates the `match_knowledge_chunks` similarity-search
function, and locks the table down so browsers can never read it directly.

---

## 10. Step 6 ⛔: run the ingestion

*Gated step — get sign-off before running (see section 3).*

```powershell
deno task ingest
```

This reads all 8 knowledge files, chunks them, embeds all 21 chunks with Gemini,
and inserts them into `knowledge_chunks`. It is **safe to re-run**: each run
clears the table and re-inserts everything, so you can never end up with
duplicates — re-run it whenever you edit a knowledge file. It takes under a
minute. It will print the same 4 clinical-content flags as the dry run; that is
expected.

---

## 11. Step 7 ⛔: deploy the chatbot function

*Gated step — get sign-off before running (see section 3).*

The deployed function does not read your local `.env` — you give it secrets
through Supabase. Open your `.env`, copy the real values, and run (skip
`COHERE_API_KEY` or `GROQ_API_KEY` if you don't have one):

```powershell
npx supabase secrets set GEMINI_API_KEY=your-real-gemini-key GROQ_API_KEY=your-groq-key COHERE_API_KEY=your-cohere-key ALLOWED_ORIGIN=https://your-frontend-url
```

`ALLOWED_ORIGIN` is the website address your frontend will call the chatbot
from — in production set it to your real frontend URL; while testing you can
leave it unset (it defaults to `*`, allow-everything, which is fine for local
development only).

⚠️ **Do not set `GEMINI_MODEL` as a secret unless you mean to.** Supabase
secrets are project-wide, so one `GEMINI_MODEL` would apply to *both*
functions and collapse the per-chatbot model split that keeps them on separate
daily quotas. The code defaults are already distinct; leave them alone, or set
`GEMINI_MODEL` and `CLARIFY_GEMINI_MODEL` together to two different models.

Then deploy both functions:

```powershell
npx supabase functions deploy general-chat clarify
```

---

## 12. Step 8: talk to your chatbot

The function requires a signed-in caller (`verify_jwt = true` in
`supabase/config.toml`), so requests need your project's **anon key** — the
public, browser-safe key from the same **Project Settings → Data API** page as
Step 4. In PowerShell:

```powershell
$ref  = "YOUR-NEW-PROJECT-REF"
$anon = "YOUR-ANON-KEY"

$body = @{ message = "What is CKD?" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://$ref.supabase.co/functions/v1/general-chat" `
  -Headers @{ Authorization = "Bearer $anon"; apikey = $anon } `
  -ContentType "application/json" `
  -Body $body
```

A successful reply looks like this (`reply` is the answer, `sources` lists the
chunks it was built from, `deflected: false` means it answered):

```json
{
  "reply": "Chronic kidney disease (CKD) means the kidneys are damaged or have been filtering blood poorly for 3 months or longer... (NIDDK, KDIGO)",
  "sources": [
    { "source": "NIDDK", "title": "CKD Basics — What the Kidneys Do and What CKD Is", "heading_path": "CKD Basics > What CKD is" }
  ],
  "deflected": false
}
```

Now try something off-topic:

```powershell
$body = @{ message = "Write bubble sort in Python" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://$ref.supabase.co/functions/v1/general-chat" `
  -Headers @{ Authorization = "Bearer $anon"; apikey = $anon } `
  -ContentType "application/json" `
  -Body $body
```

```json
{
  "reply": "Sorry — I can only answer questions about kidney health and chronic kidney disease (CKD). I can't help with that. You can ask me things like what CKD is, its stages and symptoms, how to keep your kidneys healthy, or kidney care in the Philippines.",
  "sources": [],
  "deflected": true
}
```

That deflection with `deflected: true` is the gate working as designed.

---

## 13. Step 9: full live test suite

```powershell
deno task test:live
```

This runs the same suite as Step 1, but with your `.env` loaded and network
access allowed — so the 8 previously-ignored tests now run too, checking real
retrieval relevance against your live database. Expected: **76 passed**.

---

## 14. Step 10: run the frontend

This project has its own web app in `frontend/` (do not confuse it with the
capstone's frontend in `E:\BATO Capstone\frontend` — that one belongs to the
old project). Like the capstone app, its home screen offers both chatbots:

- **Check my CKD risk** (`/assessment`) — the SCORED Risk Assessment. The
  screening state machine, scoring rules, and clarification assistant still
  run on the **original capstone Supabase project's** deployed `screening`
  and `clarify` functions; this frontend calls them as-is (anonymous
  sign-in, consent gate first). Nothing about the scoring was copied or
  reimplemented here.
- **Ask about kidney health** (`/chat`) — the hardened General CKD chatbot,
  backed by THIS project's `general-chat` function.

One-time setup (already done if `frontend/.env` exists): copy
`frontend/.env.example` to `frontend/.env` and fill in all four values —
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from this project's
**Project Settings → Data API**, and `VITE_ASSESSMENT_SUPABASE_URL` +
`VITE_ASSESSMENT_SUPABASE_PUBLISHABLE_KEY` from the capstone project's same
page. Then:

```powershell
cd "E:\BATO CHATBOT V2\frontend"
npm install    # first time only
npm run dev
```

Open **http://localhost:5173** in your browser. The port matters: the
deployed function's `ALLOWED_ORIGIN` secret is pinned to
`http://localhost:5173`, and the dev server is configured with `strictPort`
so it fails loudly instead of silently moving to another port (which would
break CORS). If you later host this frontend publicly, update the secret to
the public URL and redeploy (see Step 7).

---

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| `deno` is not recognized | VS Code was open before Deno was installed, so it has a stale PATH. Fully restart VS Code (permanent fix), or paste `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')` into the current terminal, or call `C:\Users\bonoy\.deno\bin\deno.exe` directly. See Step 0 |
| Gemini returns `503 UNAVAILABLE` | Temporary overload on Google's side — wait and retry. The deployed chatbot fails safe (it deflects instead of crashing) |
| Tests fail after you edit code | Run `deno task check` to find type errors first, then re-run `deno task test` |
| `db push` errors about an existing table | You linked a project that already has `knowledge_chunks` — almost certainly the capstone project. See the Option B warning in Step 4 |
| Real CKD questions get empty replies / deflections | Ingestion probably hasn't run yet — the table is empty, so nothing can be retrieved. Do Step 6 |
| CORS errors in the browser | Set the `ALLOWED_ORIGIN` secret to your frontend's URL and redeploy the function (Step 7) |

---

## 16. Glossary

- **RAG** — Retrieval-Augmented Generation: retrieve trusted text first, then generate the answer only from it.
- **Embedding** — a list of numbers representing a text's meaning, made by an AI model.
- **Vector** — that list of numbers (768 of them here); texts with similar meaning have similar vectors.
- **pgvector** — a Postgres extension that stores vectors and finds the nearest ones fast.
- **Chunk** — a small section of a knowledge file (one heading's worth), the unit that gets embedded and retrieved.
- **Cosine similarity** — a 0-to-1 score of how close two vectors point; higher means more similar meaning.
- **Reranker** — a second model (Cohere) that re-orders retrieved chunks by true relevance to the question.
- **Edge Function** — a small server program hosted by Supabase, reachable over HTTPS.
- **Service role key** — the secret master key to your database; server-side only, never in frontends or git.
- **Anon key** — the public, browser-safe Supabase key; it only allows what your access rules permit.
- **Migration** — a SQL script that creates or changes database structure, applied once and tracked.
- **Prompt injection** — an attack where a message tries to override the AI's instructions ("ignore your rules and...").
- **Deflection** — the bot's polite fixed refusal for off-topic, unsafe, or unanswerable questions.
