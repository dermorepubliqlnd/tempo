// Knowledge Base -- Phase 55, 2026-09-21.
//
// Sandra: "next we want to create some sort of a knowledge base. starting
// off with definitions of properties... Add a knowledge base page
// accessible to everyone, then start Project then properties of a
// project." Read access is everyone (RLS: select using (true), see
// phase55_migration.sql); edit access (create/rename/reorder/delete
// categories and entries) is Full Access only, per her explicit answer
// to "who should be able to edit" -- matches every other
// admin-configurable list in this app (SiteSettings.tsx's Categories,
// Sources, Work Types, etc.), just scoped to a page everyone can *read*
// instead of one gated entirely to Admin (Admin.tsx/SiteSettings.tsx
// show an AccessDenied wall for non-Full-Access people; this page never
// does that -- only the Edit/New/Delete controls disappear).
//
// Content is markdown-lite plain text (matches NotesSidebar.tsx's own
// plain-text-body convention -- no rich-text/HTML stored). renderMarkdownLite
// below supports the handful of constructs actually needed for a
// definitions glossary: #/##/### headers, **bold**, *italic*, "- "
// bullets, "1. " numbered lists, "| a | b |" tables, blank-line
// paragraphs.
//
// Every edit snapshots the entry's pre-edit title/content into
// kb_entry_versions before applying the update, so in-app editing never
// silently loses the previous wording (Full Access only can read that
// history, via the "History" button on an entry).
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, Pencil, Trash2, ChevronRight, History, X, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";

interface KbCategory {
  id: string;
  name: string;
  sort_order: number;
}

interface KbEntry {
  id: string;
  category_id: string;
  title: string;
  content: string;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
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
  // "use colors id needed to to create that visual retention and
  // consistency". Written in the source content itself (not inferred),
  // so a property's Options list reads with the same color coding a
  // person would already recognize from the table.
  out = out.replace(
    /\{(success|warning|danger|neutral|accent|purple|pink|gold|mint|slate|available):([^}]+)\}/g,
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

export default function KnowledgeBase() {
  const { person: me } = useSession();
  const { confirm, alert, dialog } = useConfirm();
  const canEdit = me?.access_level === "full";

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newEntryFor, setNewEntryFor] = useState<string | null>(null); // category_id
  const [newEntryTitle, setNewEntryTitle] = useState("");

  const [historyFor, setHistoryFor] = useState<KbEntry | null>(null);
  const [versions, setVersions] = useState<KbVersion[] | null>(null);

  async function loadAll() {
    setLoading(true);
    const [{ data: catData }, { data: entryData }, { data: peopleData }] = await Promise.all([
      supabase.from("kb_categories").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
      supabase
        .from("kb_entries")
        .select("id,category_id,title,content,sort_order,updated_at,updated_by")
        .eq("is_active", true)
        .order("sort_order"),
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

  const entriesByCategory = useMemo(() => {
    const map = new Map<string, KbEntry[]>();
    for (const e of entries) {
      if (!map.has(e.category_id)) map.set(e.category_id, []);
      map.get(e.category_id)!.push(e);
    }
    return map;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }, [search, entries]);

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) ?? null;

  // Default to the first entry once loaded, so the page never opens blank.
  useEffect(() => {
    if (!loading && !selectedEntryId && entries.length > 0) {
      setSelectedEntryId(entries[0].id);
    }
  }, [loading, entries, selectedEntryId]);

  function personName(id: string | null): string {
    if (!id) return "—";
    return people.find((p) => p.id === id)?.name ?? "—";
  }

  function startEdit() {
    if (!selectedEntry) return;
    setDraftTitle(selectedEntry.title);
    setDraftContent(selectedEntry.content);
    setEditing(true);
  }

  async function saveEdit() {
    if (!selectedEntry || !me) return;
    setSaving(true);
    // Snapshot the pre-edit version before overwriting, so the previous
    // wording is never silently lost.
    await supabase.from("kb_entry_versions").insert({
      entry_id: selectedEntry.id,
      title: selectedEntry.title,
      content: selectedEntry.content,
      edited_by: selectedEntry.updated_by,
    });
    const { error } = await supabase
      .from("kb_entries")
      .update({ title: draftTitle.trim(), content: draftContent, updated_by: me.id, updated_at: new Date().toISOString() })
      .eq("id", selectedEntry.id);
    setSaving(false);
    if (error) {
      await alert(`Couldn't save: ${error.message}`);
      return;
    }
    setEditing(false);
    loadAll();
  }

  async function deleteEntry(entry: KbEntry) {
    const ok = await confirm({
      title: "Delete entry",
      message: `Delete "${entry.title}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("kb_entries").delete().eq("id", entry.id);
    if (error) {
      await alert(`Couldn't delete: ${error.message}`);
      return;
    }
    if (selectedEntryId === entry.id) setSelectedEntryId(null);
    loadAll();
  }

  async function deleteCategory(cat: KbCategory) {
    const count = entriesByCategory.get(cat.id)?.length ?? 0;
    if (count > 0) {
      await alert(`"${cat.name}" has ${count} ${count === 1 ? "entry" : "entries"} in it. Move or delete those first.`);
      return;
    }
    const ok = await confirm({ title: "Delete category", message: `Delete "${cat.name}"?`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("kb_categories").delete().eq("id", cat.id);
    if (error) {
      await alert(`Couldn't delete: ${error.message}`);
      return;
    }
    loadAll();
  }

  async function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const sort_order = categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 1 : 1;
    const { error } = await supabase.from("kb_categories").insert({ name, sort_order, created_by: me?.id });
    if (error) {
      await alert(`Couldn't create category: ${error.message}`);
      return;
    }
    setNewCategoryName("");
    setNewCategoryOpen(false);
    loadAll();
  }

  async function createEntry(categoryId: string) {
    const title = newEntryTitle.trim();
    if (!title) return;
    const siblingEntries = entriesByCategory.get(categoryId) ?? [];
    const sort_order = siblingEntries.length > 0 ? Math.max(...siblingEntries.map((e) => e.sort_order)) + 1 : 1;
    const { data, error } = await supabase
      .from("kb_entries")
      .insert({ category_id: categoryId, title, content: "", sort_order, created_by: me?.id, updated_by: me?.id })
      .select("id")
      .single();
    if (error) {
      await alert(`Couldn't create entry: ${error.message}`);
      return;
    }
    setNewEntryTitle("");
    setNewEntryFor(null);
    await loadAll();
    if (data) {
      setSelectedEntryId((data as { id: string }).id);
      setEditing(true);
      setDraftTitle(title);
      setDraftContent("");
    }
  }

  async function openHistory(entry: KbEntry) {
    setHistoryFor(entry);
    setVersions(null);
    const { data } = await supabase
      .from("kb_entry_versions")
      .select("id,title,content,edited_at,edited_by")
      .eq("entry_id", entry.id)
      .order("edited_at", { ascending: false });
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

  return (
    <div>
      {dialog}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={18} style={{ flexShrink: 0 }} />
            Knowledge Base
          </h1>
          <p className="subtitle">Definitions and reference material for CapaciQ, kept up to date by the L&amp;D team.</p>
        </div>
        {canEdit && (
          <button className="btn-secondary" onClick={() => setNewCategoryOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> New category
          </button>
        )}
      </div>

      {newCategoryOpen && (
        <div className="card" style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            autoFocus
            placeholder="Category name (e.g. Tasks, Approval Center)"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCategory()}
            style={{ flex: 1, fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
          />
          <button className="btn-primary" onClick={createCategory}>Add</button>
          <button className="btn-secondary" onClick={() => { setNewCategoryOpen(false); setNewCategoryName(""); }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Left: category/entry nav */}
        <div className="card" style={{ width: 280, flexShrink: 0, padding: 10 }}>
          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: "var(--muted)" }} />
            <input
              placeholder="Search knowledge base…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "6px 8px 6px 26px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                boxSizing: "border-box",
              }}
            />
          </div>

          {filteredEntries ? (
            filteredEntries.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>No matches.</p>
            ) : (
              filteredEntries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setSelectedEntryId(e.id);
                    setEditing(false);
                    setSearch("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    fontSize: 12.5,
                    padding: "6px 8px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: e.id === selectedEntryId ? "var(--hover-bg)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {e.title}
                </button>
              ))
            )
          ) : categories.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>
              No categories yet.{canEdit ? " Add one above to get started." : ""}
            </p>
          ) : (
            categories.map((cat) => {
              const catEntries = entriesByCategory.get(cat.id) ?? [];
              return (
                <div key={cat.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 2px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {cat.name}
                    </span>
                    {canEdit && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          title="Add entry"
                          onClick={() => setNewEntryFor(newEntryFor === cat.id ? null : cat.id)}
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", padding: 2 }}
                        >
                          <Plus size={13} />
                        </button>
                        {catEntries.length === 0 && (
                          <button
                            title="Delete category"
                            onClick={() => deleteCategory(cat)}
                            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", padding: 2 }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {newEntryFor === cat.id && (
                    <div style={{ display: "flex", gap: 6, padding: "4px 4px 8px" }}>
                      <input
                        autoFocus
                        placeholder="Entry title (e.g. Properties)"
                        value={newEntryTitle}
                        onChange={(e) => setNewEntryTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createEntry(cat.id)}
                        style={{ flex: 1, fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                      />
                      <button className="btn-primary" style={{ padding: "4px 8px", fontSize: 11.5 }} onClick={() => createEntry(cat.id)}>
                        Add
                      </button>
                    </div>
                  )}

                  {catEntries.length === 0 ? (
                    <p style={{ fontSize: 11.5, color: "var(--muted)", padding: "2px 8px" }}>No entries yet.</p>
                  ) : (
                    catEntries.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setSelectedEntryId(e.id);
                          setEditing(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          width: "100%",
                          textAlign: "left",
                          fontSize: 12.5,
                          padding: "6px 8px",
                          borderRadius: "var(--radius-sm)",
                          border: "none",
                          background: e.id === selectedEntryId ? "var(--hover-bg)" : "transparent",
                          cursor: "pointer",
                          color: "var(--text)",
                        }}
                      >
                        <ChevronRight size={12} style={{ flexShrink: 0, color: "var(--muted)" }} />
                        {e.title}
                      </button>
                    ))
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: entry content */}
        <div className="card" style={{ flex: 1, minWidth: 0, padding: 24 }}>
          {!selectedEntry ? (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {categories.length === 0
                ? "Nothing here yet."
                : "Select an entry on the left to read it."}
            </p>
          ) : editing ? (
            <div>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  fontFamily: "var(--font-heading)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 10px",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                }}
              />
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={"Write in markdown-lite:\n# Heading\n**bold**, *italic*\n- bullet\n| Property | Definition |\n|---|---|\n| Name | What it means |"}
                style={{
                  width: "100%",
                  minHeight: 360,
                  fontSize: 12.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                  boxSizing: "border-box",
                  resize: "vertical",
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn-primary" disabled={saving} onClick={saveEdit}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button className="btn-secondary" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-heading)" }}>{selectedEntry.title}</h2>
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="btn-secondary" onClick={() => openHistory(selectedEntry)} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                      <History size={13} /> History
                    </button>
                    <button className="btn-secondary" onClick={startEdit} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => deleteEntry(selectedEntry)}
                      style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--danger-text)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 0, marginBottom: 18 }}>
                Last updated {fmtDateTime(selectedEntry.updated_at)} by {personName(selectedEntry.updated_by)}
              </p>
              {selectedEntry.content.trim() ? (
                <div className="kb-content" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(selectedEntry.content) }} />
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  This entry is empty.{canEdit ? " Click Edit to write it." : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {historyFor && (
        <div
          onClick={() => setHistoryFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: 560, maxHeight: "80vh", overflowY: "auto", padding: 20 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>History — {historyFor.title}</h3>
              <button onClick={() => setHistoryFor(null)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>
            {versions === null ? (
              <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</p>
            ) : versions.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No prior versions — this entry hasn't been edited yet.</p>
            ) : (
              versions.map((v) => (
                <div key={v.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    {fmtDateTime(v.edited_at)} · {personName(v.edited_by)}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{v.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                    {v.content.length > 400 ? v.content.slice(0, 400) + "…" : v.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
