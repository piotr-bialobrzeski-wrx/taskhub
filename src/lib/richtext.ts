// Jeden zestaw rozszerzeń edytora pola z formatowaniem (RichField) i testu obiegu: to, co pisze agent, ma wrócić z pola bajt w bajt.
// StarterKit plus tabele, listy zadań i linia pozioma; Markdown czyta i zapisuje treść szkicu.
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { fromEditorMd } from "./format";

export const richExtensions = () => [
  StarterKit.configure({ underline: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown,
];

// edytor dokleja pustą linię na końcu (a przed tabelą na początku): odstępy na brzegach nie są zmianą
export const tidy = (m: string) => m.replace(/^\n+/, "").replace(/\s+$/, "");
// treść z edytora w postaci do zapisu: bez encji i ucieczek, które edytor dokłada od siebie
export const editorOut = (e: Pick<Editor, "getMarkdown">) => fromEditorMd(tidy(e.getMarkdown()));
