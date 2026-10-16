"use client";
// Jedno pole szukania w prawym górnym rogu każdego ekranu. Wyniki w sekcjach (zadania, kroki, projekty, archiwum, ustawienia, zasady),
// a kolejność sekcji zależy od ekranu: najpierw to, co na nim widać. Ekran może obsłużyć kliknięcie u siebie (onPick → true), inaczej idziemy pod href.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Lvl, ToolIcon, projColor, toolColor } from "./ui";
import { KIND_LABEL, sections, tokens, type Screen, type SearchItem } from "@/lib/search-core";

type Props = {
  index: SearchItem[]; screen: Screen; here?: string | null;
  value?: string; onChange?: (q: string) => void;        // sterowane z zewnątrz (kanwa blednie kafelki, archiwum filtruje wiersze)
  onPick?: (it: SearchItem) => boolean | void;
};

export function SearchPill({ index, screen, here, value, onChange, onPick }: Props) {
  const router = useRouter();
  const [inner, setInner] = useState("");
  const q = value ?? inner;
  const setQ = (v: string) => { setInner(v); onChange?.(v); };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const words = useMemo(() => tokens(q), [q]);
  const secs = useMemo(() => sections(index, words, screen, here), [index, words, screen, here]);
  const first = secs[0]?.items[0] ?? null;

  // „/” albo Ctrl/Cmd+K: kursor do szukajki (poza polami tekstowymi)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest?.("input, textarea, [contenteditable]");
      if ((e.key === "/" && !inField) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ref.current?.focus(); ref.current?.select(); }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);

  // ta sama strona z kotwicą (np. /settings#token z ekranu ustawień): zmiana samego hasha, żeby HashOpener dostał zdarzenie hashchange
  const pick = (it: SearchItem) => {
    setOpen(false); ref.current?.blur(); if (onPick?.(it)) return;
    const [path, hash] = it.href.split("#");
    if (hash && path === location.pathname) { if (location.hash === "#" + hash) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = hash; return; }
    router.push(it.href);
  };
  const openTask = (it: SearchItem) => { setOpen(false); router.push(it.kind === "step" && it.taskId ? it.href : `/tasks/${it.id}`); };

  const lead = (it: SearchItem) => {
    switch (it.kind) {
      case "task": return <Lvl base={it.lvl!.base} eff={it.lvl!.eff} />;
      case "step": return <span className="sr-ic" style={{ ["--c" as string]: toolColor(it.tool ?? "manual") }}><ToolIcon tool={it.tool ?? "manual"} size={14} /></span>;
      case "project": return <span className="pdot" style={{ ["--c" as string]: projColor(it.color ?? 0) }} />;
      case "done": return <span className="sr-ic ok"><Icon k="check" size={14} sw={2} /></span>;
      case "trash": return <span className="sr-ic"><Icon k="trash" size={14} sw={1.7} /></span>;
      case "setting": return <span className="sr-ic"><Icon k="settings" size={14} sw={1.6} /></span>;
      case "rule": return <span className="sr-ic"><Icon k="rule" size={14} sw={1.6} /></span>;
    }
  };
  const row = (it: SearchItem) => (
    <button key={it.kind + it.id} type="button" role="option" className="sr" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
      onDoubleClick={it.kind === "task" || it.kind === "done" || it.kind === "trash" ? () => openTask(it) : undefined}
      title={it.kind === "task" && screen === "canvas" ? "Kliknij: pokaż na kanwie · dwuklik: otwórz" : undefined}>
      {lead(it)}
      <span className="n-title">{it.title}</span>
      {it.tag ? <span className="proj-tag" style={{ ["--c" as string]: projColor(it.tag.color) }}>{it.tag.name}</span> : null}
      {it.badge ? <span className={"st " + (it.badgeCls ?? "")}>{it.badge}</span> : it.sub ? <span className="sr-sub">{it.sub}</span> : null}
    </button>
  );

  return (
    <div className={"gpill glass srch" + (q ? " on" : "")} role="search">
      <Icon k="search" size={15} sw={1.8} />
      <input ref={ref} type="text" value={q} placeholder="Szukaj… (/)" aria-label="Szukaj" autoComplete="off" spellCheck={false}
        onChange={(e) => { setQ(e.currentTarget.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setQ(""); e.currentTarget.blur(); } else if (e.key === "Enter" && first) { e.preventDefault(); pick(first); } }} />
      {q ? <button className="icobtn sm" type="button" aria-label="Wyczyść" onClick={() => { setQ(""); ref.current?.focus(); }}><Icon k="x" size={11} sw={2.2} /></button> : null}
      {open && words.length ? (
        <div className="sres glass" role="listbox" aria-label="Wyniki szukania">
          {secs.length ? secs.map((s) => (
            <div key={s.kind} className="sr-sec">
              <span className="sr-h">{KIND_LABEL[s.kind]}</span>
              {s.items.map(row)}
              {s.more ? <span className="sr-more">…i jeszcze {s.more}</span> : null}
            </div>
          )) : <span className="sub" style={{ padding: "6px 10px" }}>Nic nie pasuje</span>}
        </div>
      ) : null}
    </div>
  );
}
