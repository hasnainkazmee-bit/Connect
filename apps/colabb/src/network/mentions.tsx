import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { NetworkMention } from "./types";
import { AtSign, Building2, UserRound } from "lucide-react";
import { networkApi } from "./client";
type Mention = { id: string; name: string; kind: "company" | "user" };
export function MentionInput({
  value,
  onChange,
  onMention,
  communityId,
  placeholder,
  required = false,
  id,
  rows = 4,
  maxLength = 10000,
}: {
  value: string;
  onChange: (value: string) => void;
  onMention?: (id: string, kind: "company" | "user") => void;
  communityId?: string | null;
  placeholder?: string;
  required?: boolean;
  id?: string;
  rows?: number;
  maxLength?: number;
}) {
  const [query, setQuery] = useState<string | null>(null),
    [results, setResults] = useState<Mention[]>([]),
    [selected, setSelected] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null),
    start = useRef(0),
    blurTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    const c = new AbortController();
    const timer = window.setTimeout(
      () =>
        networkApi<{ items: Mention[] }>(
          `/mentions?q=${encodeURIComponent(query)}${communityId ? `&community_id=${encodeURIComponent(communityId)}` : ""}`,
          { signal: c.signal },
        )
          .then((r) => {
            setResults(r.items);
            setSelected(0);
          })
          .catch(() => setResults([])),
      180,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, communityId]);
  const detect = (element: HTMLTextAreaElement) => {
    const before = element.value.slice(0, element.selectionStart);
    const match = before.match(/(?:^|\s)@([^@\n]{0,40})$/);
    if (match) {
      start.current = before.lastIndexOf("@");
      setQuery(match[1]);
    } else setQuery(null);
  };
  const choose = (item: Mention) => {
    const el = ref.current;
    if (!el) return;
    const end = el.selectionStart;
    const insert = `@${item.name} `;
    onChange(value.slice(0, start.current) + insert + value.slice(end));
    onMention?.(item.id, item.kind);
    setQuery(null);
    setResults([]);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        start.current + insert.length,
        start.current + insert.length,
      );
    });
  };
  return (
    <div className="nw-mention-input">
      <textarea
        id={id}
        ref={ref}
        value={value}
        required={required}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-expanded={results.length > 0}
        aria-controls={
          results.length ? `${id || "network"}-mentions` : undefined
        }
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onFocus={() => clearTimeout(blurTimer.current)}
        onBlur={() => {
          clearTimeout(blurTimer.current);
          blurTimer.current = window.setTimeout(() => setQuery(null), 150);
        }}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((i) => (i + 1) % results.length);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) => (i + results.length - 1) % results.length);
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(results[selected]);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
          }
        }}
      />
      {results.length > 0 && (
        <div
          className="nw-mentions"
          id={`${id || "network"}-mentions`}
          role="listbox"
          aria-label="Mention a person or company"
        >
          {results.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.kind === "company" ? (
                <Building2 size={17} />
              ) : (
                <UserRound size={17} />
              )}
              <span>
                {item.name}
                <small>{item.kind === "company" ? "Company" : "Person"}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MentionText({
  text,
  mentions = [],
}: {
  text: string;
  mentions?: NetworkMention[];
}) {
  const valid = mentions
    .filter((m) => m.name && /^[0-9a-f-]{36}$/i.test(m.id))
    .sort((a, b) => b.name.length - a.name.length);
  if (!valid.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let found: { index: number; mention: NetworkMention } | null = null;
    for (const mention of valid) {
      const index = text.indexOf(`@${mention.name}`, cursor);
      if (index >= 0 && (!found || index < found.index))
        found = { index, mention };
    }
    if (!found) {
      parts.push(text.slice(cursor));
      break;
    }
    if (found.index > cursor) parts.push(text.slice(cursor, found.index));
    const label = `@${found.mention.name}`;
    parts.push(
      found.mention.kind === "company" ? (
        <Link
          className="nw-mention-link"
          to={`/network/companies/${found.mention.id}`}
          key={found.index}
        >
          {label}
        </Link>
      ) : (
        <span
          className="nw-mention-link"
          title={found.mention.name}
          key={found.index}
        >
          {label}
        </span>
      ),
    );
    cursor = found.index + label.length;
  }
  return <>{parts}</>;
}
