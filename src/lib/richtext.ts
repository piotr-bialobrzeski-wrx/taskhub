// Jeden zestaw rozszerzeń edytora pola z formatowaniem (RichField) i testu obiegu: to, co pisze agent, ma wrócić z pola bajt w bajt.
// StarterKit plus tabele, listy zadań i linia pozioma; Markdown czyta i zapisuje treść szkicu.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { fromEditorMd } from "./format";
import { mentionAt, mentionToken, MENTION_SRC } from "./mention";

// wzmianka osoby `<@aplikacja:id|Imię Nazwisko>` (src/lib/mention.ts) w polu to jeden znacznik „@Imię Nazwisko” (kasuje się w całości),
// a w zapisie wraca ten sam zapis bajt w bajt; edytor dostaje „<” jako „&lt;” (toEditorMd), tokenizer bierze obie postacie
const START = new RegExp(MENTION_SRC);
export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ app: { default: "" }, id: { default: "" }, name: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-mention]", getAttrs: (el) => ({ app: el.getAttribute("data-app") ?? "", id: el.getAttribute("data-id") ?? "", name: (el.textContent ?? "").replace(/^@/, "") }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-mention": "", "data-app": node.attrs.app, "data-id": node.attrs.id, class: "mention-tag", title: `${node.attrs.app} · ${node.attrs.id}` }), `@${node.attrs.name}`],
  renderText: ({ node }) => `@${node.attrs.name}`,
  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: (src: string) => { const m = START.exec(src); return m ? m.index : -1; },
    tokenize: (src: string) => { const m = mentionAt(src); return m ? { type: "mention", raw: m.raw, app: m.app, id: m.id, name: m.name } : undefined; },
  },
  parseMarkdown: (token, h) => h.createNode("mention", { app: token.app, id: token.id, name: token.name }),
  renderMarkdown: (node) => mentionToken({ app: node.attrs?.app ?? "", id: node.attrs?.id ?? "", name: node.attrs?.name ?? "" }),
});

export const richExtensions = () => [
  StarterKit.configure({ underline: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  MentionNode,
  Markdown,
];

// edytor dokleja pustą linię na końcu (a przed tabelą na początku): odstępy na brzegach nie są zmianą
export const tidy = (m: string) => m.replace(/^\n+/, "").replace(/\s+$/, "");
// treść z edytora w postaci do zapisu: bez encji i ucieczek, które edytor dokłada od siebie
export const editorOut = (e: Pick<Editor, "getMarkdown">) => fromEditorMd(tidy(e.getMarkdown()));
