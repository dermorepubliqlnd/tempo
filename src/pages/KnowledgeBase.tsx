// Knowledge Base -- Phase 55 (2026-09-21), redesigned Phase 107 (2026-09-24).
//
// Phase 107 (Sandra: "remove the persistent KB category panel... search-
// first, easy to browse... categories shouldn't permanently consume
// horizontal space"): three URL-addressable views, no second sidebar --
//   /knowledge-base                         Home: search, Browse by topic,
//                                           Frequently used (pinned),
//                                           Recently updated
//   /knowledge-base?q=...                   Search results (title, category,
//                                           content, with a matching snippet)
//   /knowledge-base/category/:categoryId    Category: breadcrumb, articles,
//                                           search within
//   /knowledge-base/article/:entryId        Article: breadcrumb, metadata,
//                                           accordion content (### sections),
//                                           related articles (same category)
// Read access is everyone; create/edit/pin/delete is Full Access only
// (RLS). Deleting routes to the Archive (phase104). Every edit still
// snapshots the previous title/content into kb_entry_versions (History).
//
// Content is markdown-lite plain text: #/##/### headers ("###" becomes a
// collapsible section), **bold**, *italic*, "- " bullets, "1. " lists,
// "| a | b |" tables, {tone:Label} pills.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, ChevronRight, History, X, Search, Pin, PinOff, FileText, Star, Clock, Settings2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { archiveItem, ARCHIVE_MOVE_NOTE } from "../lib/archive";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { CATEGORY_ICON_LIBRARY, CATEGORY_ICON_NAMES, CATEGORY_TONE_NAMES, CATEGORY_TONE_ICON_COLOR } from "../lib/categoryIcons";

interface KbCategory {
  id: string;
  name: string;
  sort_order: number;
  description: string | null;
  icon: string | null;
  color: string | null;
}

interface KbEntry {
  id: string;
  category_id: string;
  title: string;
  content: string;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
  is_pinned: boolean;
}

interface KbVersion {
  id: string;
  title: string;
  content: string;
  edited_at: string;
  edited_by: string | null;
}

interface PersonLite {
  id: string;
  name: string;
}

// ---- markdown-lite renderer -------------------------------------------
// Deliberately small and dependency-free (this codebase has no
// react-markdown/contentEditable anywhere -- see NotesSidebar.tsx's own
// plain-text convention). Handles just what a definitions glossary needs.
function renderInline(text: string): string {
  let out = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // {tone:Label} -> a colored status pill, reusing the exact same
  // .status-pill classes/colors the rest of the app already uses for
  // this value (Status/Health/Priority/Planning Type/Project Type/
  // Phase/Complexity pills on the Projects table) -- Sandra, 2026-09-21:
  // blue/skyblue added 2026-09-23 so the Productivity KB entry can pill
  // the Very Low / Below Expected logged-hours tiers, same colors as
  // loggedHoursBands.ts.
  // "use colors id needed to to create that visual retention and
  // consistency". Written in the source content itself (not inferred),
  // so a property's Options list reads with the same color coding a
  // person would already recognize from the table.
  out = out.replace(
    /\{(success|warning|danger|neutral|accent|purple|pink|gold|mint|slate|available|blue|skyblue):([^}]+)\}/g,
    '<span class="status-pill $1">$2</span>'
  );
  return out;
}

function renderMarkdownLite(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let listMode: "ul" | "ol" | null = null;

  function closeList() {
    if (listMode) {
      html.push(listMode === "ul" ? "</ul>" : "</ol>");
      listMode = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      i++;
      continue;
    }

    // "### Title" is special: everything up to the next heading (of any
    // level) becomes a collapsible <details> section -- this is what lets
    // an individual property (e.g. "Status", "Hrs Variance %") be written
    // once with its full definition/options/formula, but read as a short
    // list that expands on click (Sandra, 2026-09-21: "was hoping ea
    // property can be expanded especially if there are options... also if
    // there's computation"). "#"/"##" stay plain (non-collapsible) section
    // headers, since those are used for the entry's own title/intro, not
    // individual properties.
    const detailMatch = /^###\s+(.*)$/.exec(trimmed);
    if (detailMatch) {
      closeList();
      const title = detailMatch[1];
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !/^#{1,3}\s+/.test(lines[i].trim())) {
        bodyLines.push(lines[i]);
        i++;
      }
      const bodyHtml = renderMarkdownLite(bodyLines.join("\n"));
      html.push(
        `<details class="kb-detail"><summary>${renderInline(title)}</summary><div class="kb-detail-body">${bodyHtml}</div></details>`
      );
      continue;
    }

    const headerMatch = /^(#{1,2})\s+(.*)$/.exec(trimmed);
    if (headerMatch) {
      closeList();
      const level = headerMatch[1].length;
      html.push(`<h${level + 2} class="kb-h${level}">${renderInline(headerMatch[2])}</h${level + 2}>`);
      i++;
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const cellsOf = (l: string) =>
        l
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim());
      const dataRows = tableLines.filter((l) => !/^\|[\s|:-]+\|$/.test(l));
      if (dataRows.length > 0) {
        const headerCells = cellsOf(dataRows[0]);
        html.push('<table class="kb-table"><thead><tr>');
        headerCells.forEach((c) => html.push(`<th>${renderInline(c)}</th>`));
        html.push("</tr></thead><tbody>");
        dataRows.slice(1).forEach((r) => {
          html.push("<tr>");
          cellsOf(r).forEach((c) => html.push(`<td>${renderInline(c)}</td>`));
          html.push("</tr>");
        });
        html.push("</tbody></table>");
      }
      continue;
    }

    const bulletMatch = /^-\s+(.*)$/.exec(trimmed);
    if (bulletMatch) {
      if (listMode !== "ul") {
        closeList();
        html.push("<ul>");
        listMode = "ul";
      }
      html.push(`<li>${renderInline(bulletMatch[1])}</li>`);
      i++;
      continue;
    }

    const numberedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numberedMatch) {
      if (listMode !== "ol") {
        closeList();
        html.push("<ol>");
        listMode = "ol";
      }
      html.push(`<li>${renderInline(numberedMatch[1])}</li>`);
      i++;
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
    i++;
  }
  closeList();
  return html.join("\n");
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Strip markdown-lite syntax down to readable plain text (for summaries,
// search snippets and word counts).
function plainText(md: string): string {
  return md
    .replace(/\{[a-z]+:([^}]+)\}/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\|?[\s|:-]+\|?$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^\s*(?:-|\d+\.)\s+/gm, "")
    .replace(/[ \t]+/g, " ");
}

// Short description = the article's first real paragraph (no new field).
function summaryOf(entry: KbEntry): string {
  const lines = entry.content.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const first = lines.find((l) => l && !/^#/.test(l) && !l.startsWith("|") && !/^(?:-|\d+\.)\s/.test(l));
  const text = first ? plainText(first).trim() : "";
  return text.length > 170 ? text.slice(0, 167).trimEnd() + "…" : text;
}

function readMinutes(entry: KbEntry): number {
  const words = plainText(entry.content).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Snippet around the first content match, with the match highlighted.
function snippetHtml(entry: KbEntry, q: string): string {
  const text = plainText(entry.content).replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeHtml(summaryOf(entry));
  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + q.length + 110);
  const before = (start > 0 ? "…" : "") + text.slice(start, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length, end) + (end < text.length ? "…" : "");
  return `${escapeHtml(before)}<mark class="kb-mark">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function CategoryIcon({ cat, size = 40 }: { cat: KbCategory | undefined; size?: number }) {
  const Icon = CATEGORY_ICON_LIBRARY[cat?.icon ?? ""] ?? FileText;
  const tone = cat?.color ?? "accent";
  return (
    <span
      className={`status-pill ${tone}`}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 12, flexShrink: 0, padding: 0 }}
    >
      <Icon size={Math.round(size * 0.48)} style={{ color: CATEGORY_TONE_ICON_COLOR[tone] ?? "var(--accent)" }} />
    </span>
  );
}

function Breadcrumb({ parts }: { parts: { label: string; to?: string }[] }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", marginBottom: 8, minWidth: 0, flexWrap: "wrap" }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {i > 0 && <ChevronRight size={12} style={{ flexShrink: 0 }} />}
          {p.to ? (
            <Link to={p.to} style={{ color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>{p.label}</Link>
          ) : (
            <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{p.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// Local-state search box so typing never re-renders (and remounts) the page.
function SearchBox({ initial, placeholder, onSubmit, large = false, showButton = false }: { initial: string; placeholder: string; onSubmit: (q: string) => void; large?: boolean; showButton?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ position: "relative", flex: 1 }}>
        <Search size={large ? 16 : 14} style={{ position: "absolute", left: large ? 14 : 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(value.trim())}
          placeholder={placeholder}
          style={{
            width: "100%", boxSizing: "border-box",
            fontSize: large ? 14 : 12.5,
            padding: large ? "12px 14px 12px 40px" : "8px 10px 8px 32px",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)",
          }}
        />
      </div>
      {showButton && (
        <button className="btn-primary" onClick={() => onSubmit(value.trim())} style={{ padding: large ? "0 24px" : undefined }}>
          Search
        </button>
      )}
    </div>
  );
}

function ArticleRow({ entry, category, to, showCategory = true, html }: { entry: KbEntry; category?: KbCategory; to: string; showCategory?: boolean; html?: string }) {
  const summary = summaryOf(entry);
  return (
    <Link to={to} className="kb-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textDecoration: "none", color: "inherit", borderTop: "1px solid var(--border)" }}>
      <FileText size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>{entry.title}</div>
        {html !== undefined ? (
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.45 }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          summary && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</div>
        )}
      </div>
      {showCategory && category && (
        <span className={`status-pill ${category.color ?? "accent"}`} style={{ fontSize: 10, flexShrink: 0 }}>{category.name}</span>
      )}
      <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{fmtDate(entry.updated_at)}</span>
      <ChevronRight size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
    </Link>
  );
}

// Category details editor (name, description, icon, color) -- Full Access.
function CategoryForm({ initial, onSave, onCancel, saving }: { initial: Partial<KbCategory>; onSave: (v: { name: string; description: string; icon: string; color: string }) => void; onCancel: () => void; saving: boolean }) {
  const [name, setName] = useState(initial.name ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [icon, setIcon] = useState(initial.icon ?? "FileText");
  const [color, setColor] = useState(initial.color ?? "accent");
  const input: CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" };
  return (
    <div className="card" style={{ marginBottom: 14, padding: 16 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <input autoFocus placeholder="Topic name (e.g. Time Tracking)" value={name} onChange={(e) => setName(e.target.value)} style={input} />
        <input placeholder="Short description shown on the topic card" value={description} onChange={(e) => setDescription(e.target.value)} style={input} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Icon</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CATEGORY_ICON_NAMES.map((n) => {
              const Icon = CATEGORY_ICON_LIBRARY[n];
              const active = icon === n;
              return (
                <button key={n} title={n} onClick={() => setIcon(n)} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: "pointer", border: active ? "2px solid var(--accent)" : "1px solid var(--border)", background: "var(--surface)" }}>
                  <Icon size={15} style={{ color: CATEGORY_TONE_ICON_COLOR[color] ?? "var(--accent)" }} />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Color</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CATEGORY_TONE_NAMES.map((t) => (
              <button key={t} onClick={() => setColor(t)} className={`status-pill ${t}`} style={{ cursor: "pointer", fontSize: 10.5, border: color === t ? "2px solid var(--navy)" : "2px solid transparent" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" disabled={saving || !name.trim()} onClick={() => onSave({ name: name.trim(), description: description.trim(), icon, color })}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function EntryEditor({ entry, saving, onSave, onCancel }: { entry: KbEntry; saving: boolean; onSave: (title: string, content: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-heading)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", width: "100%", boxSizing: "border-box", marginBottom: 10 }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={"Write in markdown-lite:\n## Heading\nFirst paragraph becomes the article's short description.\n### Collapsible section\n**bold**, *italic*\n- bullet\n| Column | Meaning |\n|---|---|\n| Name | What it means |"}
        style={{ width: "100%", minHeight: 420, fontSize: 12.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn-primary" disabled={saving || !title.trim()} onClick={() => onSave(title.trim(), content)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const READING_WIDTH = 860;

export default function KnowledgeBase() {
  const { person: me } = useSession();
  const canEdit = me?.access_level === "full";
  const { confirm, alert, dialog } = useConfirm();
  const navigate = useNavigate();
  const { categoryId, entryId } = useParams<{ categoryId?: string; entryId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categoryFormFor, setCategoryFormFor] = useState<"new" | string | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [historyFor, setHistoryFor] = useState<KbEntry | null>(null);
  const [versions, setVersions] = useState<KbVersion[] | null>(null);
  // A just-created article opens straight into edit mode.
  const pendingEditId = useRef<string | null>(null);

  async function loadAll() {
    const [{ data: catData }, { data: entryData }, { data: peopleData }] = await Promise.all([
      supabase.from("kb_categories").select("id,name,sort_order,description,icon,color").eq("is_active", true).order("sort_order"),
      supabase.from("kb_entries").select("id,category_id,title,content,sort_order,updated_at,updated_by,is_pinned").eq("is_active", true).order("sort_order"),
      supabase.from("people").select("id,name"),
    ]);
    setCategories((catData as KbCategory[]) ?? []);
    setEntries((entryData as KbEntry[]) ?? []);
    setPeople((peopleData as PersonLite[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Leaving an article/category resets transient edit state.
  useEffect(() => {
    setEditingEntryId(entryId && pendingEditId.current === entryId ? entryId : null);
    pendingEditId.current = null;
    setNewEntryOpen(false);
    setCategoryFormFor(null);
  }, [categoryId, entryId]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const entriesByCategory = useMemo(() => {
    const map = new Map<string, KbEntry[]>();
    for (const e of entries) {
      if (!map.has(e.category_id)) map.set(e.category_id, []);
      map.get(e.category_id)!.push(e);
    }
    return map;
  }, [entries]);

  const personName = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "—" : "—");

  function runSearch(value: string, scopeCategoryId?: string) {
    const params: Record<string, string> = {};
    if (value) params.q = value;
    if (scopeCategoryId) {
      setSearchParams(params);
    } else {
      navigate(value ? `/knowledge-base?q=${encodeURIComponent(value)}` : "/knowledge-base");
    }
  }

  // 2026-09-24 (Sandra: "make the search global too and appearing in all
  // pages in the KB") -- every KB page gets the same breadcrumb row with a
  // compact search box on the right that always searches the WHOLE KB.
  const topBar = (parts: { label: string; to?: string }[]) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={{ minWidth: 0, flex: "1 1 300px" }}>
        <Breadcrumb parts={parts} />
      </div>
      <div style={{ flex: "0 1 340px", minWidth: 240 }}>
        <SearchBox initial="" placeholder="Search the Knowledge Base..." onSubmit={(v) => runSearch(v)} />
      </div>
    </div>
  );

  // Search: title (strongest) > category name > content.
  function searchEntries(query: string, pool: KbEntry[]): KbEntry[] {
    const ql = query.toLowerCase();
    return pool
      .map((e) => {
        const cat = categoryById.get(e.category_id)?.name.toLowerCase() ?? "";
        const score = e.title.toLowerCase().includes(ql) ? 3 : cat.includes(ql) ? 2 : plainText(e.content).toLowerCase().includes(ql) ? 1 : 0;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title))
      .map((x) => x.e);
  }

  // ---- admin actions -----------------------------------------------------
  async function saveCategory(v: { name: string; description: string; icon: string; color: string }) {
    setSaving(true);
    let error;
    if (categoryFormFor === "new") {
      const sort_order = categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 1;
      ({ error } = await supabase.from("kb_categories").insert({ name: v.name, description: v.description || null, icon: v.icon, color: v.color, sort_order, created_by: me?.id }));
    } else if (categoryFormFor) {
      ({ error } = await supabase.from("kb_categories").update({ name: v.name, description: v.description || null, icon: v.icon, color: v.color }).eq("id", categoryFormFor));
    }
    setSaving(false);
    if (error) {
      await alert(`Couldn't save topic: ${error.message}`);
      return;
    }
    setCategoryFormFor(null);
    loadAll();
  }

  async function deleteCategory(cat: KbCategory) {
    const count = entriesByCategory.get(cat.id)?.length ?? 0;
    const ok = await confirm({
      title: "Delete topic",
      message: `Delete "${cat.name}"${count > 0 ? ` and its ${count} ${count === 1 ? "article" : "articles"}` : ""}? ${ARCHIVE_MOVE_NOTE}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const { error } = await archiveItem("kb_category", cat.id);
    if (error) {
      await alert(`Couldn't delete: ${error.message}`);
      return;
    }
    navigate("/knowledge-base");
    loadAll();
  }

  async function createEntry(catId: string) {
    const title = newEntryTitle.trim();
    if (!title) return;
    const siblings = entriesByCategory.get(catId) ?? [];
    const sort_order = siblings.length > 0 ? Math.max(...siblings.map((e) => e.sort_order)) + 1 : 1;
    const { data, error } = await supabase
      .from("kb_entries")
      .insert({ category_id: catId, title, content: "", sort_order, created_by: me?.id, updated_by: me?.id })
      .select("id")
      .single();
    if (error) {
      await alert(`Couldn't create article: ${error.message}`);
      return;
    }
    setNewEntryTitle("");
    setNewEntryOpen(false);
    await loadAll();
    if (data) {
      const id = (data as { id: string }).id;
      pendingEditId.current = id;
      navigate(`/knowledge-base/article/${id}`);
    }
  }

  async function saveEntry(entry: KbEntry, title: string, content: string) {
    if (!me) return;
    setSaving(true);
    await supabase.from("kb_entry_versions").insert({ entry_id: entry.id, title: entry.title, content: entry.content, edited_by: entry.updated_by });
    const { error } = await supabase.from("kb_entries").update({ title, content, updated_by: me.id, updated_at: new Date().toISOString() }).eq("id", entry.id);
    setSaving(false);
    if (error) {
      await alert(`Couldn't save: ${error.message}`);
      return;
    }
    setEditingEntryId(null);
    loadAll();
  }

  async function togglePin(entry: KbEntry) {
    const { error } = await supabase.from("kb_entries").update({ is_pinned: !entry.is_pinned }).eq("id", entry.id);
    if (error) {
      await alert(`Couldn't update: ${error.message}`);
      return;
    }
    loadAll();
  }

  async function deleteEntry(entry: KbEntry) {
    const ok = await confirm({ title: "Delete article", message: `Delete "${entry.title}"? ${ARCHIVE_MOVE_NOTE}`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const { error } = await archiveItem("kb_entry", entry.id);
    if (error) {
      await alert(`Couldn't delete: ${error.message}`);
      return;
    }
    navigate(`/knowledge-base/category/${entry.category_id}`);
    loadAll();
  }

  async function openHistory(entry: KbEntry) {
    setHistoryFor(entry);
    setVersions(null);
    const { data } = await supabase.from("kb_entry_versions").select("id,title,content,edited_at,edited_by").eq("entry_id", entry.id).order("edited_at", { ascending: false });
    setVersions((data as KbVersion[]) ?? []);
  }

  if (loading) {
    return (
      <div>
        <h1>Knowledge Base</h1>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  const iconBtn: CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 };
  const sectionCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" };
  const sectionHead = (icon: JSX.Element, title: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", fontSize: 13.5, fontWeight: 700, color: "var(--navy)" }}>
      {icon}
      {title}
    </div>
  );

  // ======================= ARTICLE =======================
  if (entryId) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) {
      return (
        <div>
          {dialog}
          {topBar([{ label: "Knowledge Base", to: "/knowledge-base" }, { label: "Not found" }])}
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>This article doesn't exist or was moved to the Archive.</p>
        </div>
      );
    }
    const cat = categoryById.get(entry.category_id);
    const related = (entriesByCategory.get(entry.category_id) ?? []).filter((e) => e.id !== entry.id).slice(0, 5);
    const summary = summaryOf(entry);
    return (
      <div>
        {dialog}
        {topBar([{ label: "Knowledge Base", to: "/knowledge-base" }, { label: cat?.name ?? "Topic", to: cat ? `/knowledge-base/category/${cat.id}` : undefined }, { label: entry.title }])}
        <div className="card" style={{ padding: "22px 28px" }}>
          <div style={{ maxWidth: READING_WIDTH }}>
            {editingEntryId === entry.id ? (
              <EntryEditor entry={entry} saving={saving} onSave={(t, c) => saveEntry(entry, t, c)} onCancel={() => setEditingEntryId(null)} />
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontFamily: "var(--font-heading)" }}>{entry.title}</h1>
                    {summary && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0", lineHeight: 1.5 }}>{summary}</p>}
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="btn-secondary" onClick={() => togglePin(entry)} style={iconBtn} title={entry.is_pinned ? "Remove from Frequently used" : "Add to Frequently used"}>
                        {entry.is_pinned ? <PinOff size={13} /> : <Pin size={13} />} {entry.is_pinned ? "Unpin" : "Pin"}
                      </button>
                      <button className="btn-secondary" onClick={() => openHistory(entry)} style={iconBtn}>
                        <History size={13} /> History
                      </button>
                      <button className="btn-secondary" onClick={() => setEditingEntryId(entry.id)} style={iconBtn}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button className="btn-secondary" onClick={() => deleteEntry(entry)} style={{ ...iconBtn, color: "var(--danger-text)" }} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, color: "var(--muted)", margin: "12px 0 18px", paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                  <span>Last updated {fmtDate(entry.updated_at)}</span>
                  <span>Updated by {personName(entry.updated_by)}</span>
                  <span>{readMinutes(entry)} min read</span>
                </div>
                {entry.content.trim() ? (
                  <div className="kb-content" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(entry.content) }} />
                ) : (
                  <p style={{ fontSize: 12.5, color: "var(--muted)" }}>This article is empty.{canEdit ? " Click Edit to write it." : ""}</p>
                )}
              </>
            )}
          </div>
        </div>
        {related.length > 0 && (
          <div style={{ ...sectionCard, marginTop: 14, maxWidth: READING_WIDTH + 56 }}>
            {sectionHead(<FileText size={15} style={{ color: "var(--accent)" }} />, "Related articles")}
            {related.map((r) => (
              <ArticleRow key={r.id} entry={r} to={`/knowledge-base/article/${r.id}`} showCategory={false} />
            ))}
          </div>
        )}
        {historyFor && renderHistory()}
      </div>
    );
  }

  // ======================= CATEGORY =======================
  if (categoryId) {
    const cat = categoryById.get(categoryId);
    if (!cat) {
      return (
        <div>
          {dialog}
          {topBar([{ label: "Knowledge Base", to: "/knowledge-base" }, { label: "Not found" }])}
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>This topic doesn't exist or was moved to the Archive.</p>
        </div>
      );
    }
    const catEntries = entriesByCategory.get(cat.id) ?? [];
    const shown = q ? searchEntries(q, catEntries) : catEntries;
    return (
      <div>
        {dialog}
        {topBar([{ label: "Knowledge Base", to: "/knowledge-base" }, { label: cat.name }])}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CategoryIcon cat={cat} size={44} />
            <div>
              <h1 style={{ margin: 0 }}>{cat.name}</h1>
              {cat.description && <p className="subtitle" style={{ margin: "2px 0 0" }}>{cat.description}</p>}
            </div>
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-secondary" onClick={() => setNewEntryOpen((v) => !v)} style={iconBtn}>
                <Plus size={13} /> New article
              </button>
              <button className="btn-secondary" onClick={() => setCategoryFormFor(cat.id)} style={iconBtn}>
                <Settings2 size={13} /> Edit topic
              </button>
              <button className="btn-secondary" onClick={() => deleteCategory(cat)} style={{ ...iconBtn, color: "var(--danger-text)" }} title="Delete topic">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {categoryFormFor === cat.id && <CategoryForm initial={cat} saving={saving} onSave={saveCategory} onCancel={() => setCategoryFormFor(null)} />}
        {newEntryOpen && (
          <div className="card" style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
            <input
              autoFocus
              placeholder="Article title"
              value={newEntryTitle}
              onChange={(e) => setNewEntryTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createEntry(cat.id)}
              style={{ flex: 1, fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
            />
            <button className="btn-primary" onClick={() => createEntry(cat.id)}>Add</button>
            <button className="btn-secondary" onClick={() => setNewEntryOpen(false)}><X size={14} /></button>
          </div>
        )}
        <div style={{ maxWidth: 520, marginBottom: 14 }}>
          <SearchBox initial={q} placeholder={`Search within ${cat.name}...`} onSubmit={(v) => runSearch(v, cat.id)} />
        </div>
        <div style={sectionCard}>
          <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--muted)" }}>
            {q ? `${shown.length} result${shown.length === 1 ? "" : "s"} for "${q}"` : `${catEntries.length} article${catEntries.length === 1 ? "" : "s"}`}
          </div>
          {shown.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
              {q ? "No articles match." : `No articles yet.${canEdit ? " Use New article to add one." : ""}`}
            </div>
          ) : (
            shown.map((e) => <ArticleRow key={e.id} entry={e} to={`/knowledge-base/article/${e.id}`} showCategory={false} html={q ? snippetHtml(e, q) : undefined} />)
          )}
        </div>
      </div>
    );
  }

  // ======================= SEARCH RESULTS =======================
  if (q) {
    const results = searchEntries(q, entries);
    return (
      <div>
        {dialog}
        <Breadcrumb parts={[{ label: "Knowledge Base", to: "/knowledge-base" }, { label: "Search" }]} />
        <div style={{ marginBottom: 14 }}>
          <SearchBox initial={q} placeholder="Search articles, features, or processes..." onSubmit={(v) => runSearch(v)} large showButton />
        </div>
        <div style={sectionCard}>
          <div style={{ padding: "12px 14px", fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
            Search results for "{q}" <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>({results.length})</span>
          </div>
          {results.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>No articles match. Try a different word, or browse by topic.</div>
          ) : (
            results.map((e) => <ArticleRow key={e.id} entry={e} category={categoryById.get(e.category_id)} to={`/knowledge-base/article/${e.id}`} html={snippetHtml(e, q)} />)
          )}
        </div>
      </div>
    );
  }

  // ======================= HOME =======================
  const pinned = entries.filter((e) => e.is_pinned).sort((a, b) => a.title.localeCompare(b.title));
  const recent = [...entries].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5);
  return (
    <div>
      {dialog}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Knowledge Base</h1>
          <p className="subtitle" style={{ marginTop: 0 }}>Guides, processes, and reference material for Tempo.</p>
        </div>
        {canEdit && (
          <button className="btn-secondary" onClick={() => setCategoryFormFor("new")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> New topic
          </button>
        )}
      </div>
      {categoryFormFor === "new" && <CategoryForm initial={{}} saving={saving} onSave={saveCategory} onCancel={() => setCategoryFormFor(null)} />}

      <div className="card" style={{ padding: 18, marginBottom: 20, background: "var(--accent-bg, #eaf2fb)", border: "1px solid var(--border)" }}>
        <SearchBox initial="" placeholder="Search articles, features, or processes..." onSubmit={(v) => runSearch(v)} large showButton />
        {categories.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Popular searches</span>
            {categories.map((c) => (
              <button key={c.id} onClick={() => runSearch(c.name.toLowerCase())} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", cursor: "pointer" }}>
                {c.name.toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Browse by topic</h2>
      {categories.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No topics yet.{canEdit ? " Use New topic to add one." : ""}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginBottom: 22 }}>
          {categories.map((c) => {
            const count = entriesByCategory.get(c.id)?.length ?? 0;
            return (
              <Link key={c.id} to={`/knowledge-base/category/${c.id}`} className="kb-topic-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", textDecoration: "none", color: "inherit" }}>
                <CategoryIcon cat={c} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>{c.name}</div>
                  {c.description && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.45 }}>{c.description}</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                    <FileText size={12} /> {count} article{count === 1 ? "" : "s"}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14 }}>
        <div style={sectionCard}>
          {sectionHead(<Star size={15} style={{ color: "var(--gold-text, #a3790a)" }} />, "Frequently used")}
          {pinned.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
              Nothing pinned yet.{canEdit ? " Open an article and click Pin to feature it here." : ""}
            </div>
          ) : (
            pinned.map((e) => <ArticleRow key={e.id} entry={e} to={`/knowledge-base/article/${e.id}`} showCategory={false} />)
          )}
        </div>
        <div style={sectionCard}>
          {sectionHead(<Clock size={15} style={{ color: "var(--accent)" }} />, "Recently updated")}
          {recent.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>No articles yet.</div>
          ) : (
            recent.map((e) => <ArticleRow key={e.id} entry={e} category={categoryById.get(e.category_id)} to={`/knowledge-base/article/${e.id}`} />)
          )}
        </div>
      </div>
    </div>
  );

  function renderHistory() {
    if (!historyFor) return null;
    return (
      <div onClick={() => setHistoryFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
        <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 560, maxHeight: "80vh", overflowY: "auto", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>History — {historyFor.title}</h3>
            <button onClick={() => setHistoryFor(null)} style={{ border: "none", background: "none", cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>
          {versions === null ? (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</p>
          ) : versions.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No prior versions — this article hasn't been edited yet.</p>
          ) : (
            versions.map((v) => (
              <div key={v.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                  {fmtDateTime(v.edited_at)} · {personName(v.edited_by)}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{v.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{v.content.length > 400 ? v.content.slice(0, 400) + "…" : v.content}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
}
