import { useEffect, useRef, useState } from "react";
import {
  askGeneralChat,
  HISTORY_EXCHANGES,
  type HistoryTurn,
  MAX_MESSAGE_LENGTH,
  type SourceCitation,
} from "../api";
import { linkHost, sourceReference } from "../lib/source-links";
import "./general-chat.css";

interface BotTurn {
  role: "bot";
  text: string;
  sources: SourceCitation[];
  deflected: boolean;
  error?: boolean;
}

interface UserTurn {
  role: "user";
  text: string;
}

type Turn = UserTurn | BotTurn;

const STARTERS = [
  "What is CKD?",
  "How are kidney stones diagnosed?",
  "How do I keep my kidneys healthy?",
  "Does PhilHealth cover dialysis?",
];

/**
 * The recent exchanges to send with the next message, so the backend can read
 * a follow-up ("how bad is this?") in context.
 *
 * Only COMPLETED exchanges count — a user turn whose reply was a deflection
 * or an error is dropped along with that reply. Two reasons: a refusal
 * carries no subject to inherit, and keeping the message that caused it would
 * let one blocked turn keep tainting every later one.
 */
function recentHistory(turns: Turn[]): HistoryTurn[] {
  const history: HistoryTurn[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const user = turns[i];
    const bot = turns[i + 1];
    if (user.role !== "user" || bot.role !== "bot") continue;
    if (bot.deflected || bot.error) continue;
    history.push({ role: "user", text: user.text });
    history.push({ role: "assistant", text: bot.text });
  }
  return history.slice(-HISTORY_EXCHANGES * 2);
}

/**
 * One attribution chip.
 *
 * A link when the source has a public page, a plain chip when it does not
 * (see lib/source-links.ts — AstraZeneca's licensed patient card has none).
 * The tooltip names the publisher and the passage either way, so the chip
 * still says where a claim came from when it cannot say it with a URL.
 */
function SourceChip({ citation }: { citation: SourceCitation }) {
  const ref = sourceReference(citation.source);
  const passage = citation.heading_path
    ? `${citation.title} — ${citation.heading_path}`
    : citation.title;
  const lines = [ref?.name, passage].filter(Boolean) as string[];

  if (!ref?.url) {
    return (
      <span className="source-chip" title={lines.join("\n")}>
        {citation.source}
      </span>
    );
  }

  return (
    <a
      className="source-chip"
      href={ref.url}
      target="_blank"
      // noopener is the security half (the opened page cannot reach back
      // through window.opener); noreferrer keeps the chat URL out of the
      // publisher's referrer logs.
      rel="noopener noreferrer"
      title={[...lines, `Opens ${linkHost(ref.url)} in a new tab`].join("\n")}
    >
      {citation.source}
    </a>
  );
}

export default function GeneralChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (turns.length === 0) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, sending]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    // Snapshot the history BEFORE appending this turn — the message being
    // sent is not part of its own context.
    const history = recentHistory(turns);
    setTurns((t) => [...t, { role: "user", text: message }]);
    try {
      const res = await askGeneralChat(message, history);
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text: res.reply,
          sources: res.sources ?? [],
          deflected: res.deflected,
        },
      ]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: "bot",
          text:
            err instanceof Error
              ? `Something went wrong: ${err.message}`
              : "Something went wrong. Please try again.",
          sources: [],
          deflected: false,
          error: true,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const remaining = MAX_MESSAGE_LENGTH - input.length;

  return (
    <div className="chat-page general-chat">
      <header className="page-title">
        <div>
          <p className="section-eyebrow">KIDNEY HEALTH GUIDE</p>
          <h1>Ask about kidney health</h1>
          <p className="page-subtitle">Clear answers to general questions, grounded in trusted health sources.</p>
        </div>
        <span className="header-badge">Source-based answers</span>
      </header>

      <div className="chat" ref={scrollRef} role="log" aria-label="Kidney health conversation" aria-live="polite">
        {turns.length === 0 && (
          <div className="empty">
            <span className="chat-empty-mark" aria-hidden="true">?</span>
            <h2>What would you like to know?</h2>
            <p className="empty-lead">
              Explore kidney conditions, tests, medicines, prevention, and
              kidney care in the Philippines.
            </p>
            <p className="starter-heading">Try a question</p>
            <div className="starters">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  className="starter"
                  onClick={() => void send(q)}
                  disabled={sending}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="bubble user">
              <span className="message-label">You</span>
              {turn.text}
            </div>
          ) : (
            <div
              key={i}
              className={
                "bubble bot" +
                (turn.deflected ? " deflected" : "") +
                (turn.error ? " error" : "")
              }
            >
              <span className="message-label">BATO</span>
              <div className="bot-text">{turn.text}</div>
              {turn.sources.length > 0 && (
                <div className="sources">
                  <span className="sources-label">Sources</span>
                  {turn.sources.map((s, j) => (
                    <SourceChip key={j} citation={s} />
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {sending && (
          <div className="bubble bot typing" role="status">
            <span className="sr-only">BATO is replying</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="general-chat-input">Your kidney health question</label>
        <textarea
          id="general-chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your question…"
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={sending}
          autoFocus
        />
        {remaining < 200 && <span className="char-count">{remaining}</span>}
        <button type="submit" disabled={sending || !input.trim()}>
          Send question
        </button>
      </form>
    </div>
  );
}
