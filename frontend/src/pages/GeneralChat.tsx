import { useEffect, useRef, useState } from "react";
import {
  askGeneralChat,
  MAX_MESSAGE_LENGTH,
  type SourceCitation,
} from "../api";

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
  "What are the stages of CKD?",
  "How do I keep my kidneys healthy?",
  "Does PhilHealth cover dialysis?",
];

export default function GeneralChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
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
    setTurns((t) => [...t, { role: "user", text: message }]);
    try {
      const res = await askGeneralChat(message);
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
    <div className="chat-page">
      <div className="page-title">
        <h2>Kidney Health Chat</h2>
        <span className="header-badge">Answers only from approved sources</span>
      </div>

      <div className="chat" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="empty">
            <p className="empty-lead">
              Ask me about kidney health and chronic kidney disease (CKD) —
              what it is, its stages and symptoms, prevention, treatment, and
              kidney care in the Philippines.
            </p>
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
              <div className="bot-text">{turn.text}</div>
              {turn.sources.length > 0 && (
                <div className="sources">
                  {turn.sources.map((s, j) => (
                    <span
                      key={j}
                      className="source-chip"
                      title={`${s.title} — ${s.heading_path}`}
                    >
                      {s.source}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {sending && (
          <div className="bubble bot typing" aria-label="Thinking">
            <span />
            <span />
            <span />
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
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about kidney health… (Enter to send)"
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={sending}
          autoFocus
        />
        {remaining < 200 && <span className="char-count">{remaining}</span>}
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
