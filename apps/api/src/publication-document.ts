import { z } from "zod";
import { HttpError } from "./db.js";

export const publicationKind = z.enum([
  "post",
  "article",
  "press_release",
  "case_study",
]);
export type DocumentNode = {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: DocumentNode[];
};
export function validateDocument(input: unknown): {
  document: DocumentNode | null;
  text: string;
  mediaIds: string[];
} {
  if (input === null || input === undefined)
    return { document: null, text: "", mediaIds: [] };
  let count = 0;
  const mediaIds: string[] = [];
  const allowed = new Set([
    "doc",
    "paragraph",
    "heading",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "hardBreak",
    "horizontalRule",
    "codeBlock",
    "image",
  ]);
  function visit(value: any, depth: number): DocumentNode {
    if (++count > 6000 || depth > 16 || !value || !allowed.has(value.type))
      throw new HttpError(
        400,
        "This document contains unsupported formatting.",
      );
    const n: DocumentNode = { type: value.type };
    if (value.type === "text") n.text = z.string().max(50000).parse(value.text);
    if (value.type === "heading")
      n.attrs = {
        level: z.number().int().min(1).max(3).parse(value.attrs?.level),
      };
    if (value.type === "orderedList")
      n.attrs = {
        start: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(value.attrs?.start ?? 1),
      };
    if (value.type === "image") {
      const src = z
        .string()
        .regex(/^\/api\/post-media\/[a-f0-9-]{36}$/)
        .parse(value.attrs?.src);
      mediaIds.push(src.split("/").pop()!);
      n.attrs = {
        src,
        alt: z
          .string()
          .max(250)
          .parse(value.attrs?.alt || ""),
        title: z
          .string()
          .max(250)
          .parse(value.attrs?.title || ""),
      };
    }
    if (value.marks)
      n.marks = z
        .array(
          z.object({
            type: z.enum([
              "bold",
              "italic",
              "strike",
              "underline",
              "code",
              "link",
            ]),
            attrs: z.any().optional(),
          }),
        )
        .max(6)
        .parse(value.marks)
        .map((m) => {
          if (m.type !== "link") return { type: m.type };
          const href = z
            .string()
            .max(2000)
            .url()
            .refine(
              (v) => /^https?:\/\//i.test(v),
              "Links must use https or http.",
            )
            .parse(m.attrs?.href);
          return {
            type: "link",
            attrs: { href, target: "_blank", rel: "noopener noreferrer" },
          };
        });
    if (value.content)
      n.content = z
        .array(z.any())
        .max(6000)
        .parse(value.content)
        .map((c) => visit(c, depth + 1));
    return n;
  }
  const document = visit(input, 0);
  if (document.type !== "doc")
    throw new HttpError(400, "Use a document as the root.");
  const plain = (n: DocumentNode): string =>
    n.text ??
    (n.content
      ?.map(plain)
      .join(
        ["doc", "blockquote", "bulletList", "orderedList"].includes(n.type)
          ? "\n"
          : "",
      ) ||
      "");
  const text = plain(document).trim();
  if (text.length > 50000)
    throw new HttpError(400, "Keep your story under 50,000 characters.");
  return { document, text, mediaIds: [...new Set(mediaIds)] };
}
