import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Avatar, Logo } from "./identity";
import { FormError, useAction } from "./management";
import type { Company } from "./types";
import "./personal-messages.css";
type Thread = {
  id: string;
  company: Company;
  person_name: string;
  status: "pending" | "accepted" | "declined";
  last_message: string;
  unread: number;
  updated_at: string;
};
type Inbox = { threads: Thread[]; unread: number; requests: number };
type PersonalMessage = {
  id: string;
  body: string;
  author_name: string;
  sender_kind: "company" | "individual";
  created_at: string;
  sequence: string;
};
type Conversation = {
  thread: Thread;
  side: "company" | "individual";
  messages: PersonalMessage[];
  peerReadSequence: string;
  nextCursor: string | null;
};
export function PersonalMessageButton({ company }: { company: Company }) {
  return (
    <Link className="button primary" to={"/messages/company/" + company.id}>
      <MessageSquare size={15} />
      Message
    </Link>
  );
}
export function InboxChannels({ personal = false }: { personal?: boolean }) {
  const { session, company, revision } = useApp(),
    [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!company) return;
    let cancel = false;
    const load = () => {
      if (document.hidden) return;
      api<Inbox>("/personal-inbox")
        .then((d) => {
          if (!cancel) setUnread(d.unread);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [company?.id, revision]);
  if (session.user?.account_type === "individual") return null;
  return (
    <nav className="inbox-channels" aria-label="Inbox type">
      <Link className={!personal ? "active" : ""} to="/messages">
        <BuildingIcon />
        Companies
      </Link>
      <Link className={personal ? "active" : ""} to="/messages/people">
        <Users size={15} />
        People{unread > 0 && <b>{unread}</b>}
      </Link>
    </nav>
  );
}
function BuildingIcon() {
  return <MessageSquare size={15} />;
}
export function PersonalInbox() {
  const { id, companyId } = useParams(),
    navigate = useNavigate();
  const { session, company, refresh } = useApp();
  const individual = session.user?.account_type === "individual";
  const [threads, setThreads] = useState<Thread[]>([]),
    [companies, setCompanies] = useState<Company[]>([]),
    [search, setSearch] = useState(""),
    [view, setView] = useState<"all" | "chats" | "requests">("all"),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [selected, setSelected] = useState<Company | null>(null),
    [body, setBody] = useState(""),
    [more, setMore] = useState(false);
  const task = useAction(),
    bottom = useRef<HTMLDivElement>(null),
    clientId = useRef(crypto.randomUUID()),
    lastText = useRef("");
  const threadId =
    id ||
    (companyId
      ? threads.find((t) => t.company.id === companyId)?.id
      : undefined);
  const [directoryPage, setDirectoryPage] = useState(1),
    [total, setTotal] = useState(0);
  const draftKey = `connect:personal-draft:${session.user?.id}:${company?.id || 'personal'}:${companyId || id || 'none'}`;
  function updateDraft(text:string) {
    setBody(text);
    try { if(text)sessionStorage.setItem(draftKey,text);else sessionStorage.removeItem(draftKey); } catch { /* Typing remains available if browser storage is full. */ }
  }
  useEffect(() => {
    if (!individual) return;
    let cancel = false;
    const timer = setTimeout(
      () =>
        api<{ companies: Company[]; total: number }>(
          "/companies?q=" +
            encodeURIComponent(search) +
            "&page=" +
            directoryPage +
            "&limit=24",
        )
          .then((d) => {
            if (!cancel) {
              setCompanies(d.companies);
              setTotal(d.total);
            }
          })
          .catch((e) => task.setError(e.message)),
      250,
    );
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [individual, search, directoryPage]);
  async function loadInbox() {
    const d = await api<Inbox>("/personal-inbox");
    setThreads(d.threads);
  }
  useEffect(() => {
    let cancel = false;
    const load = () => {
      if (document.hidden) return;
      api<Inbox>("/personal-inbox")
        .then((d) => {
          if (!cancel) setThreads(d.threads);
        })
        .catch((e) => {
          if (!cancel) task.setError(e.message);
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [company?.id, session.user?.id]);
  useEffect(() => {
    setConversation(null);
    setSelected(null);
    try { setBody(sessionStorage.getItem(draftKey)||''); } catch { setBody(''); }
    clientId.current = crypto.randomUUID();
    lastText.current = "";
    task.setError("");
    if (companyId) {
      let cancel = false;
      api<{ company: Company }>("/companies/" + companyId)
        .then((d) => {
          if (!cancel) setSelected(d.company);
        })
        .catch((e) => task.setError(e.message));
      return () => {
        cancel = true;
      };
    }
  }, [id, companyId, draftKey]);
  useEffect(() => {
    if (!threadId) return;
    let cancel = false;
    const load = () => {
      if (document.hidden) return;
      api<Conversation>("/personal-inbox/" + threadId)
        .then((d) => {
          if (!cancel) {
            setConversation((old) =>
              old && old.thread.id === d.thread.id
                ? {
                    ...d,
                    messages: [
                      ...old.messages.filter(
                        (m) => !d.messages.some((n) => m.id === n.id),
                      ),
                      ...d.messages,
                    ],
                    nextCursor: old.nextCursor,
                  }
                : d,
            );
            setSelected(d.thread.company);
          }
        })
        .catch((e) => {
          if (!cancel) task.setError(e.message);
        });
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [threadId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation?.messages.at(-1)?.id]);
  const current = conversation?.thread;
  const canSend =
    current?.status === "accepted" || (individual && !!selected && !threadId);
  const list =
    individual && view === "all"
      ? companies
      : threads.filter(
          (t) =>
            (view !== "requests" || t.status === "pending") &&
            (individual ? t.company.name : t.person_name)
              .toLowerCase()
              .includes(search.toLowerCase()),
        );
  return (
    <div className="people-inbox-wrap">
      <InboxChannels personal />
      <div className={"people-inbox " + (id || companyId ? "has-chat" : "")}>
        <aside className="people-list">
          <header>
            <h1>{individual ? "Messages" : "People"}</h1>
            <p>
              {individual
                ? "Start a conversation with any company."
                : "Customer conversations, shared with your team."}
            </p>
          </header>
          <label className="people-search">
            <Search size={16} />
            <input
              aria-label={individual ? "Search companies" : "Search people"}
              placeholder={individual ? "Search companies…" : "Search people…"}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setDirectoryPage(1);
              }}
            />
          </label>
          <div className="people-list-tabs">
            {(individual ? ["all", "chats"] : ["all", "requests"]).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v as typeof view)}
              >
                {v === "all"
                  ? individual
                    ? "All companies"
                    : "All messages"
                  : v === "chats"
                    ? "My chats"
                    : "Requests"}
                {v === "requests" &&
                  threads.filter((t) => t.status === "pending").length > 0 && (
                    <b>
                      {threads.filter((t) => t.status === "pending").length}
                    </b>
                  )}
              </button>
            ))}
          </div>
          <div className="people-list-scroll">
            {list.map((item) => {
              const t =
                  "person_name" in item
                    ? (item as Thread)
                    : threads.find((t) => t.company.id === item.id),
                c =
                  "person_name" in item
                    ? (item as Thread).company
                    : (item as Company),
                name = individual ? c.name : t?.person_name || "";
              return (
                <Link
                  className={
                    "people-thread " +
                    ((individual ? selected?.id === c.id : threadId === t?.id)
                      ? "active"
                      : "")
                  }
                  key={t?.id || c.id}
                  to={
                    individual
                      ? "/messages/company/" + c.id
                      : "/messages/people/" + t!.id
                  }
                >
                  {individual ? <Logo company={c} /> : <Avatar name={name} />}
                  <div>
                    <strong>{name}</strong>
                    <p>
                      {t?.last_message ||
                        [c.type, c.location].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {t?.status === "pending" ? (
                    <span
                      className="people-request-dot"
                      title="Message request"
                    />
                  ) : (
                    !!t?.unread && <b>{t.unread}</b>
                  )}
                </Link>
              );
            })}
            {!list.length && (
              <div className="people-no-chats">
                <MessageSquare size={25} />
                <strong>
                  {search ? "No matches yet." : "You’re all caught up."}
                </strong>
                <p>
                  {individual
                    ? "Try a company name or explore the directory."
                    : "Messages from individual customers will appear here."}
                </p>
              </div>
            )}
            {individual && view === "all" && total > 24 && (
              <div className="people-page">
                <button
                  disabled={directoryPage === 1}
                  onClick={() => setDirectoryPage((v) => v - 1)}
                >
                  Previous
                </button>
                <span>{directoryPage}</span>
                <button
                  disabled={directoryPage * 24 >= total}
                  onClick={() => setDirectoryPage((v) => v + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </aside>
        <section className="people-chat">
          {selected || current ? (
            <>
              <header className="people-chat-header">
                <Link
                  className="people-back icon-button"
                  to={individual ? "/messages" : "/messages/people"}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={20} />
                </Link>
                {individual && selected ? (
                  <Logo company={selected} />
                ) : (
                  <Avatar name={current?.person_name || ""} />
                )}
                <div>
                  <strong>
                    {individual ? selected?.name : current?.person_name}
                  </strong>
                  <span>
                    {current?.status === "accepted"
                      ? individual
                        ? "Company conversation"
                        : "Individual customer"
                      : current?.status === "pending"
                        ? "Message request"
                        : current?.status === "declined"
                          ? "Request declined"
                          : "Start a conversation"}
                  </span>
                </div>
                {individual && selected && (
                  <Link
                    className="icon-button"
                    aria-label="View company profile"
                    to={"/company/" + (selected.username || selected.slug)}
                  >
                    <ArrowUpRight size={18} />
                  </Link>
                )}
              </header>
              <div className="people-message-history">
                {conversation?.nextCursor && (
                  <button
                    className="older-messages"
                    disabled={more}
                    onClick={async () => {
                      setMore(true);
                      try {
                        const d = await api<Conversation>(
                          "/personal-inbox/" +
                            threadId +
                            "?before=" +
                            conversation.nextCursor,
                        );
                        setConversation((old) =>
                          old
                            ? {
                                ...old,
                                messages: [...d.messages, ...old.messages],
                                nextCursor: d.nextCursor,
                              }
                            : d,
                        );
                      } catch (e) {
                        task.setError((e as Error).message);
                      } finally {
                        setMore(false);
                      }
                    }}
                  >
                    Earlier messages
                  </button>
                )}
                {!current && (
                  <div className="people-start">
                    <Logo company={selected!} size="large" />
                    <h2>Say hello to {selected?.name}.</h2>
                    <p>
                      Send a short introduction. You can keep chatting once the
                      company accepts.
                    </p>
                  </div>
                )}
                {conversation?.messages.map((m, i) => {
                  const mine = m.sender_kind === conversation.side,
                    day = new Date(m.created_at).toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                    }),
                    prev = conversation.messages[i - 1];
                  return (
                    <div key={m.id}>
                      {(!prev ||
                        new Date(prev.created_at).toDateString() !==
                          new Date(m.created_at).toDateString()) && (
                        <div className="people-day">{day}</div>
                      )}
                      <div className={"people-message " + (mine ? "mine" : "")}>
                        <small>
                          {m.author_name}
                          {!individual && !mine
                            ? ""
                            : " · " +
                              (mine && !individual
                                ? company?.name
                                : m.sender_kind === "company"
                                  ? selected?.name
                                  : "")}
                        </small>
                        <p>{m.body}</p>
                        <span>
                          {new Date(m.created_at).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                          {mine &&
                            (Number(m.sequence) <=
                            Number(conversation.peerReadSequence) ? (
                              <CheckCheck size={13} />
                            ) : (
                              <Check size={13} />
                            ))}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              <FormError error={task.error} />
              {current?.status === "pending" ? (
                individual ? (
                  <div className="people-consent">
                    <ShieldCheck size={18} />
                    <p>
                      Your request is sent. You can chat when {selected?.name}{" "}
                      accepts.
                    </p>
                  </div>
                ) : (
                  <div className="people-consent incoming">
                    <div>
                      <ShieldCheck size={20} />
                      <span>
                        <strong>Start this conversation?</strong>
                        <p>
                          {current.person_name} wants to talk to your company.
                        </p>
                      </span>
                    </div>
                    <button
                      className="button"
                      disabled={task.busy}
                      onClick={() =>
                        void task.run(async () => {
                          await post(
                            "/personal-inbox/" + threadId + "/respond",
                            { accept: false },
                          );
                          setConversation(
                            await api("/personal-inbox/" + threadId),
                          );
                          await loadInbox();
                          refresh();
                        })
                      }
                    >
                      Decline
                    </button>
                    <button
                      className="button primary"
                      disabled={task.busy}
                      onClick={() =>
                        void task.run(async () => {
                          await post(
                            "/personal-inbox/" + threadId + "/respond",
                            { accept: true },
                          );
                          setConversation(
                            await api("/personal-inbox/" + threadId),
                          );
                          await loadInbox();
                          refresh();
                        })
                      }
                    >
                      Accept
                    </button>
                  </div>
                )
              ) : current?.status === "declined" ? (
                <div className="people-consent">
                  <p>This request was declined. New messages can’t be sent.</p>
                </div>
              ) : (
                canSend && (
                  <form
                    className="people-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!body.trim()) return;
                      void task.run(async () => {
                        if (lastText.current !== body) {
                          clientId.current = crypto.randomUUID();
                          lastText.current = body;
                        }
                        if (threadId) {
                          await post(
                            "/personal-inbox/" + threadId + "/messages",
                            { body, clientId: clientId.current },
                          );
                          setConversation(
                            await api("/personal-inbox/" + threadId),
                          );
                          updateDraft("");
                          lastText.current = "";
                          clientId.current = crypto.randomUUID();
                        } else {
                          const t = await post<Thread>("/personal-inbox", {
                            companyId: selected!.id,
                            body,
                            clientId: clientId.current,
                          });
                          updateDraft("");
                          navigate("/messages/company/" + selected!.id);
                          setConversation(await api("/personal-inbox/" + t.id));
                        }
                        await loadInbox();
                        refresh();
                      });
                    }}
                  >
                    <textarea
                      aria-label="Message"
                      placeholder={
                        current ? "Write a message…" : "Introduce yourself…"
                      }
                      value={body}
                      maxLength={current ? 4000 : 2000}
                      rows={2}
                      onChange={(e) => updateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <button
                      disabled={task.busy || !body.trim()}
                      className="button primary"
                      aria-label={
                        current ? "Send message" : "Send message request"
                      }
                      type="submit"
                    >
                      <Send size={18} />
                      {!current && <span>Send request</span>}
                    </button>
                  </form>
                )
              )}
            </>
          ) : (
            <div className="people-chat-empty">
              <span>
                <MessageSquare size={32} />
              </span>
              <h2>A conversation away.</h2>
              <p>
                {individual
                  ? "Choose a company and say hello."
                  : "Choose a conversation to reply as " + company?.name + "."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
