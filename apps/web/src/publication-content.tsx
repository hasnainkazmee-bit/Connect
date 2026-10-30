import { type ReactNode } from "react";
import "./publication-content.css";
import {
  FileText,
  MessageSquare,
  BookOpen,
  Newspaper,
  BriefcaseBusiness,
} from "lucide-react";
export type PublicationKind =
  "post" | "article" | "press_release" | "case_study";
export const formats: {
  value: PublicationKind;
  label: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    value: "post",
    label: "Post",
    description: "A moment, an idea, a conversation.",
    icon: MessageSquare,
  },
  {
    value: "article",
    label: "Article",
    description: "Give your ideas room to grow.",
    icon: BookOpen,
  },
  {
    value: "press_release",
    label: "Press release",
    description: "Share the news worth knowing.",
    icon: Newspaper,
  },
  {
    value: "case_study",
    label: "Case study",
    description: "The challenge. The work. The result.",
    icon: BriefcaseBusiness,
  },
];
export function RichDocument({ document }: { document: any }) {
  const render = (n: any, i: number): ReactNode => {
    if (!n) return null;
    let children: ReactNode = n.text ?? n.content?.map(render);
    for (const m of n.marks || [])
      children =
        m.type === "bold" ? (
          <strong>{children}</strong>
        ) : m.type === "italic" ? (
          <em>{children}</em>
        ) : m.type === "underline" ? (
          <u>{children}</u>
        ) : m.type === "strike" ? (
          <s>{children}</s>
        ) : m.type === "code" ? (
          <code>{children}</code>
        ) : m.type === "link" && /^https?:\/\//i.test(m.attrs?.href || "") ? (
          <a href={m.attrs.href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ) : (
          children
        );
    switch (n.type) {
      case "doc":
        return <div key={i}>{children}</div>;
      case "text":
        return <span key={i}>{children}</span>;
      case "paragraph":
        return <p key={i}>{children || <br />}</p>;
      case "heading":
        return n.attrs?.level === 3 ? (
          <h3 key={i}>{children}</h3>
        ) : (
          <h2 key={i}>{children}</h2>
        );
      case "blockquote":
        return <blockquote key={i}>{children}</blockquote>;
      case "bulletList":
        return <ul key={i}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={i} start={n.attrs?.start}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={i}>{children}</li>;
      case "hardBreak":
        return <br key={i} />;
      case "horizontalRule":
        return <hr key={i} />;
      case "codeBlock":
        return (
          <pre key={i}>
            <code>{children}</code>
          </pre>
        );
      case "image":
        return /^\/api\/post-media\/[a-f0-9-]{36}$/.test(n.attrs?.src || "") ? (
          <figure key={i}>
            <img src={n.attrs.src} alt={n.attrs.alt || ""} loading="lazy" />
            {n.attrs.title && <figcaption>{n.attrs.title}</figcaption>}
          </figure>
        ) : null;
      default:
        return null;
    }
  };
  return <div className="story-prose">{render(document, 0)}</div>;
}
