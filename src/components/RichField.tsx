"use client";
// Pole z formatowaniem dla treści, która poleci do ClickUp, Slacka albo maila: pasek z nagłówkami, pogrubieniem, kursywą, listami i linkiem,
// a w środku już sformatowany tekst (bez gwiazdek i krzyżyków). Zapisuje Markdown, ten sam, który pisze agent; format aplikacji docelowej
// powstaje dopiero przy wysyłce (src/lib/format.ts). Zapis sam po wyjściu z pola; ukryte pole `form` niesie treść także do „Zatwierdź”.
import { useEffect, useRef, useState, useTransition } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Markdown as MdView } from "@/lib/markdown";

const I: Record<string, React.ReactNode> = {
  ul: <><circle cx="3" cy="4.5" r=".9" fill="currentColor" /><circle cx="3" cy="8" r=".9" fill="currentColor" /><circle cx="3" cy="11.5" r=".9" fill="currentColor" /><path d="M6 4.5h8M6 8h8M6 11.5h8" /></>,
  ol: <><path d="M2.4 3.4 3.4 3v3M2.4 6h2M6.5 4.5h7.5M6.5 8h7.5M6.5 11.5h7.5" /><path d="M2.3 9.6c.3-.5 1.9-.6 1.9.4 0 .8-1.9 1.4-1.9 2.2h2" /></>,
  link: <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />,
};
const Svg = ({ k }: { k: string }) => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[k]}</svg>;

// edytor dokleja pustą linię na końcu: końcowe odstępy nie są zmianą
const tidy = (m: string) => m.replace(/\s+$/, "");

export function RichField({ value, onSave, form, name = "body", placeholder = "Treść, która ma polecieć…", label = "Treść szkicu", minHeight = 96 }: {
  value: string; onSave?: (md: string) => Promise<void>; form?: string; name?: string; placeholder?: string; label?: string; minHeight?: number;
}) {
  const [md, setMd] = useState(value);
  const saved = useRef(value);      // ostatnio zapisany Markdown (w postaci, jaką zwraca edytor)
  const prop = useRef(value);       // ostatnia treść z serwera
  const [state, setState] = useState<"idle" | "dirty" | "saved">("idle");
  const [saving, start] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  const save = () => {
    if (!onSave || md === saved.current) return;
    const next = md;
    start(async () => { await onSave(next); saved.current = next; setState("saved"); });
  };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ underline: false, horizontalRule: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] } }),
      Markdown,
    ],
    content: value, contentType: "markdown",
    editorProps: { attributes: { class: "rf-doc md", "aria-label": label, role: "textbox", "aria-multiline": "true" } },
    // edytor zapisuje Markdown po swojemu (np. pusta linia po nagłówku): to punkt odniesienia, żeby samo otwarcie nie liczyło się jako zmiana
    onCreate: ({ editor }) => { saved.current = tidy(editor.getMarkdown()); setMd(saved.current); },
    onUpdate: ({ editor }) => { const m = tidy(editor.getMarkdown()); setMd(m); setState(m === saved.current ? "idle" : "dirty"); },
    onBlur: () => { /* zapis po wyjściu z pola: patrz efekt niżej (stan md jest już aktualny) */ setBlurTick((n) => n + 1); },
  });
  const [blurTick, setBlurTick] = useState(0);
  useEffect(() => { if (blurTick) save(); }, [blurTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // nowa treść z serwera (agent poprawił szkic): podmień, o ile Piotr nie ma niezapisanych zmian
  useEffect(() => {
    if (!editor || value === prop.current) return;
    prop.current = value;
    if (state === "dirty" || value === saved.current) return;   // własny zapis wrócił z serwera: nie ruszaj pola (kursor i zaznaczenie zostają)
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    saved.current = tidy(editor.getMarkdown()); setMd(saved.current);
  }, [value, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const on = useEditorState({
    editor,
    selector: ({ editor: e }: { editor: Editor | null }) => e ? {
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), b: e.isActive("bold"), i: e.isActive("italic"), s: e.isActive("strike"),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), a: e.isActive("link"), empty: e.isEmpty,
    } : null,
  });

  const run = (f: (e: Editor) => void) => (ev: React.MouseEvent) => { ev.preventDefault(); if (editor) f(editor); };
  const openLink = run((e) => { setHref(e.getAttributes("link").href ?? ""); setLinkOpen(true); });
  const applyLink = () => {
    if (!editor) return;
    const u = href.trim();
    const c = editor.chain().focus().extendMarkRange("link");
    const full = /^(https?:|mailto:)/.test(u) ? u : `https://${u}`;
    if (!u) c.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) c.insertContent({ type: "text", text: u, marks: [{ type: "link", attrs: { href: full } }] }).run();   // bez zaznaczenia: wstaw sam adres jako link
    else c.setLink({ href: full }).run();
    setLinkOpen(false);
  };
  const Btn = ({ k, title, active, onDown, children }: { k: string; title: string; active?: boolean; onDown: (e: React.MouseEvent) => void; children: React.ReactNode }) => (
    <button key={k} type="button" className={"rf-b" + (active ? " on" : "")} title={title} aria-label={title} aria-pressed={!!active} onMouseDown={onDown}>{children}</button>
  );

  return (
    <div className="rf">
      <div className="rf-bar" role="toolbar" aria-label="Formatowanie">
        <Btn k="h1" title="Nagłówek" active={on?.h1} onDown={run((e) => e.chain().focus().toggleHeading({ level: 1 }).run())}><span className="rf-h">H1</span></Btn>
        <Btn k="h2" title="Podtytuł" active={on?.h2} onDown={run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}><span className="rf-h">H2</span></Btn>
        <span className="rf-sep" />
        <Btn k="b" title="Pogrubienie (⌘B)" active={on?.b} onDown={run((e) => e.chain().focus().toggleBold().run())}><b>B</b></Btn>
        <Btn k="i" title="Kursywa (⌘I)" active={on?.i} onDown={run((e) => e.chain().focus().toggleItalic().run())}><i>I</i></Btn>
        <Btn k="s" title="Przekreślenie" active={on?.s} onDown={run((e) => e.chain().focus().toggleStrike().run())}><s>S</s></Btn>
        <span className="rf-sep" />
        <Btn k="ul" title="Lista punktowana" active={on?.ul} onDown={run((e) => e.chain().focus().toggleBulletList().run())}><Svg k="ul" /></Btn>
        <Btn k="ol" title="Lista numerowana" active={on?.ol} onDown={run((e) => e.chain().focus().toggleOrderedList().run())}><Svg k="ol" /></Btn>
        <Btn k="a" title="Link" active={on?.a || linkOpen} onDown={openLink}><Svg k="link" /></Btn>
        <span className="sp" />
        {onSave ? <span className="rf-st" aria-live="polite">{saving ? "Zapisuję…" : state === "dirty" ? "Niezapisane" : state === "saved" ? "Zapisano" : ""}</span> : null}
      </div>
      {linkOpen ? (
        <div className="rf-link">
          <input className="in" autoFocus value={href} placeholder="Adres linku" aria-label="Adres linku" onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); editor?.commands.focus(); } }} />
          <button type="button" className="btn" onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>{href.trim() ? "Wstaw" : "Usuń link"}</button>
        </div>
      ) : null}
      <div className="rf-box" style={{ minHeight }}>
        {on?.empty ? <span className="rf-ph" aria-hidden="true">{placeholder}</span> : null}
        {editor ? <EditorContent editor={editor} /> : <div className="rf-doc">{value ? <MdView text={value} /> : null}</div>}
      </div>
      <input type="hidden" name={name} value={md} form={form} readOnly />
    </div>
  );
}
