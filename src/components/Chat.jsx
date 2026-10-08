"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  RiAddLine, RiSearchLine, RiSendPlaneFill, RiAttachment2, RiCloseLine,
  RiEdit2Line, RiDeleteBin6Line, RiReplyLine, RiFileLine, RiImageLine,
  RiCustomerService2Line, RiChatOffLine, RiArrowGoBackLine, RiMessage2Line, RiGroupLine,
  RiMoreFill,
} from "react-icons/ri";
import {
  listConversations, getMessages, sendMessage, editMessage, deleteMessage,
  openConversation, uploadAttachment, fmtSize, MAX_ATTACHMENT_BYTES,
} from "../utils/chatApi.js";

// Reusable parent<->school chat surface. The owning portal injects:
//   me            { side: 'student'|'school', key: string, name: string }
//   listFilter    arg for listConversations ({ studentId } | { teacherStaffId } | { adminAll })
//   loadContacts  async () => contact[]  (each: { title, subtitle, kind, ...openConversation fields })
//   getPeer       (conv) => { title, subtitle }   // how the thread header/list shows the other party
//   placeholder   composer placeholder text
// Copy of this file lives in each project's src/components (they are separate apps).

const time = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayLabel = (d) => {
  const dt = new Date(d), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(dt, today)) return "Today";
  if (same(dt, y)) return "Yesterday";
  return dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
};

export default function Chat({ me, listFilter, loadContacts, getPeer, placeholder = "Type a message…" }) {
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [filter, setFilter] = useState("");
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [menuFor, setMenuFor] = useState(null);   // message whose options menu is open
  const [confirmDel, setConfirmDel] = useState(null); // message pending delete confirmation
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [pending, setPending] = useState(null); // { uploading, result }
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(null);   // { loading, contacts, query }
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  const loadConvs = useCallback(async () => {
    try { setConvs(await listConversations(listFilter)); }
    catch (e) { console.error(e); }
  }, [JSON.stringify(listFilter)]);

  useEffect(() => { loadConvs(); }, [loadConvs]);
  // poll the list while the page is open
  useEffect(() => {
    const t = setInterval(loadConvs, 10000);
    return () => clearInterval(t);
  }, [loadConvs]);

  const loadMsgs = useCallback(async (convId) => {
    if (!convId) return;
    try { setMsgs(await getMessages(convId)); }
    catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!active) { setMsgs([]); setMenuFor(null); return; }
    setMenuFor(null);
    let alive = true;
    setLoadingMsgs(true);
    getMessages(active.id).then((m) => { if (alive) { setMsgs(m); setLoadingMsgs(false); } })
      .catch(() => alive && setLoadingMsgs(false));
    const t = setInterval(async () => {
      try { const m = await getMessages(active.id); if (alive) setMsgs(m); } catch (_) {}
    }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, active?.id]);

  const openThread = async (c) => {
    try {
      const conv = await openConversation(c);
      setActive(conv);
      setConvs((prev) => ([conv, ...prev.filter((x) => x.id !== conv.id)]));
      setPicker(null); setFilter("");
    } catch (e) { toast.error(e.message || "Could not open chat"); }
  };

  const pickContact = async () => {
    setPicker({ loading: true, contacts: [], query: "" });
    try {
      const contacts = await loadContacts();
      setPicker((p) => (p ? { ...p, loading: false, contacts } : p));
    }
    catch (e) { setPicker(null); toast.error(e.message || "Could not load contacts"); }
  };

  const autoGrow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; } };
  useEffect(autoGrow, [text]);

  const canSend = (text.trim() || pending?.result) && !sending && !pending?.uploading;

  const onSend = async () => {
    if (!active || !canSend) return;
    setSending(true);
    try {
      await sendMessage({ conversationId: active.id, me, body: text, attachment: pending?.result || null, replyToId: replyTo?.id || null });
      setText(""); setReplyTo(null); setPending(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadMsgs(active.id); loadConvs();
    } catch (e) { toast.error(e.message || "Failed to send"); }
    finally { setSending(false); }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) { toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB.`); e.target.value = ""; return; }
    setPending({ uploading: true, name: file.name });
    try { const res = await uploadAttachment(active.id, file); setPending({ result: res }); }
    catch (err) { toast.error(err.message || "Upload failed"); setPending(null); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const onEditSave = async (id) => {
    try { await editMessage(id, editText); setMsgs((m) => m.map((x) => x.id === id ? { ...x, body: editText.trim(), edited_at: new Date().toISOString() } : x)); setEditId(null); }
    catch (e) { toast.error(e.message || "Could not edit"); }
  };

  // Called from the in-app confirmation modal, so no window.confirm here.
  const onDelete = async (id) => {
    try { await deleteMessage(id); setMsgs((m) => m.map((x) => x.id === id ? { ...x, deleted: true, body: "", attachment_url: null } : x)); setConfirmDel(null); toast.success("Message deleted"); }
    catch (e) { toast.error(e.message || "Could not delete"); }
  };

  const onCopy = async (body) => {
    try { await navigator.clipboard.writeText(body); toast.success("Copied"); }
    catch (_) { toast.error("Copy failed"); }
  };

  const byId = useMemo(() => Object.fromEntries(msgs.map((m) => [m.id, m])), [msgs]);
  const visibleConvs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => { const p = getPeer(c); return (p.title + " " + p.subtitle).toLowerCase().includes(q); });
  }, [convs, filter, getPeer]);

  const filteredContacts = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.trim().toLowerCase();
    if (!q) return picker.contacts;
    return picker.contacts.filter((c) => (c.title + " " + (c.subtitle || "")).toLowerCase().includes(q));
  }, [picker]);

  const renderAttachment = (m) => {
    if (!m.attachment_url) return null;
    const isImg = (m.attachment_mime || "").startsWith("image/");
    if (isImg) return <a href={m.attachment_url} target="_blank" rel="noopener noreferrer"><img src={m.attachment_url} alt={m.attachment_name || "image"} loading="lazy" /></a>;
    return (
      <a className="chat-attach" href={m.attachment_url} target="_blank" rel="noopener noreferrer">
        <RiFileLine /> <span>{m.attachment_name || "file"}</span>{m.attachment_size ? <small style={{ opacity: .7 }}>· {fmtSize(m.attachment_size)}</small> : null}
      </a>
    );
  };

  return (
    <div className="ap-page">
      <div className="ap-head">
        <div>
          <h1 className="ap-title"><span className="ap-title-ic"><RiMessage2Line /></span>Messages</h1>
          <p className="ap-sub">Secure chat between you, parents and the school office.</p>
        </div>
        <div className="ap-actions"><button className="ap-btn primary" onClick={pickContact}><RiAddLine /> New chat</button></div>
      </div>

      <div className={"chat-shell" + (active ? " thread-open" : "")}>
        {/* ---------- list ---------- */}
        <div className="chat-sidebar">
          <div className="chat-sidebar-head"><b>Conversations</b></div>
          <div className="chat-search">
            <div className="position-relative">
              <input className="ap-input" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <RiSearchLine style={{ position: "absolute", right: 10, top: 9, opacity: .5 }} />
            </div>
          </div>
          <div className="chat-convlist">
            {visibleConvs.length === 0 ? (
              <div style={{ padding: 16, color: "var(--text-secondary,#9ca3af)", fontSize: ".85rem", textAlign: "center" }}>
                No chats yet. Use <b>New chat</b> to message a parent, or the school office will reach you here.
              </div>
            ) : visibleConvs.map((c) => {
              const p = getPeer(c);
              return (
                <div key={c.id} className={"chat-conv" + (active?.id === c.id ? " active" : "")} onClick={() => setActive(c)}>
                  <span className="chat-conv-title">{p.title}</span>
                  {p.subtitle && <span className="chat-conv-sub">{p.subtitle}</span>}
                  <span className="chat-conv-badge">{c.school_type === "admin" ? "Admin/Office" : "Teacher"}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- thread ---------- */}
        <div className="chat-main">
          {!active ? (
            <div className="chat-empty">
              <RiChatOffLine size={44} />
              <p>Select a conversation or start a new chat.</p>
            </div>
          ) : (
            <>
              <div className="chat-thread-head">
                <button className="chat-back" onClick={() => setActive(null)}><RiArrowGoBackLine /></button>
                <RiCustomerService2Line size={20} color="#022aa1" />
                <div>
                  <div className="t-title">{getPeer(active).title}</div>
                  <div className="t-sub">{getPeer(active).subtitle}</div>
                </div>
              </div>

              <div className="chat-scroll" ref={scrollRef}>
                {loadingMsgs && <div style={{ textAlign: "center", color: "#9ca3af", fontSize: ".82rem" }}>Loading…</div>}
                {msgs.map((m, i) => {
                  const own = m.sender_key ? m.sender_key === me.key : m.sender_side === me.side;
                  const prevDay = i > 0 ? dayLabel(msgs[i - 1].created_at) : null;
                  const showDay = i === 0 || prevDay !== dayLabel(m.created_at);
                  const quoted = m.reply_to_id ? byId[m.reply_to_id] : null;
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
                      <div className={"chat-row" + (own ? " own" : "")}>
                        {/* Options trigger: left of my bubbles, right of theirs — one
                            big tap target instead of the tiny hover icon strip */}
                        {own && !m.deleted && (
                          <button className="chat-menu-btn" title="Message options" aria-label="Message options"
                            onClick={() => setMenuFor(menuFor?.id === m.id ? null : m)}><RiMoreFill /></button>
                        )}
                        <div className={"chat-bubble" + (m.deleted ? " deleted" : "")}>
                          {!own && m.sender_name && <div className="sender">{m.sender_name}</div>}
                          {quoted && !m.deleted && (
                            <div className="chat-reply-quote">↩ {quoted.sender_name || "You"}: {quoted.deleted ? "(deleted)" : (quoted.body || (quoted.attachment_name || "attachment"))}</div>
                          )}
                          {editId === m.id ? (
                            <div>
                              <textarea className="ap-input" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} />
                              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                <button className="ap-btn sm primary" onClick={() => onEditSave(m.id)}>Save</button>
                                <button className="ap-btn sm ghost" onClick={() => setEditId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            m.deleted ? <span>🚫 This message was deleted</span>
                              : (<>{m.body && <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>}{renderAttachment(m)}</>)
                          )}
                          <div className="chat-meta">
                            {time(m.created_at)}{m.edited_at && !m.deleted ? " · edited" : ""}
                          </div>
                        </div>
                        {!own && !m.deleted && (
                          <button className="chat-menu-btn" title="Message options" aria-label="Message options"
                            onClick={() => setMenuFor(menuFor?.id === m.id ? null : m)}><RiMoreFill /></button>
                        )}
                        {/* Custom options menu, anchored to the message */}
                        {menuFor?.id === m.id && (
                          <>
                            <div className="chat-menu-backdrop" onClick={() => setMenuFor(null)} />
                            <div className={"chat-menu-pop" + (i < 3 ? " down" : "")} role="menu">
                              <button className="chat-menu-opt" role="menuitem"
                                onClick={() => { setMenuFor(null); setReplyTo(m); autoGrow(); taRef.current?.focus(); }}>
                                <RiReplyLine /> Reply
                              </button>
                              {m.body && (
                                <button className="chat-menu-opt" role="menuitem"
                                  onClick={() => { setMenuFor(null); onCopy(m.body); }}>
                                  <RiFileLine /> Copy
                                </button>
                              )}
                              {/* sender-only actions: received messages show Reply + Copy only */}
                              {own && m.body && (
                                <button className="chat-menu-opt" role="menuitem"
                                  onClick={() => { setMenuFor(null); setEditId(m.id); setEditText(m.body); }}>
                                  <RiEdit2Line /> Edit
                                </button>
                              )}
                              {own && (
                                <button className="chat-menu-opt danger" role="menuitem"
                                  onClick={() => { setMenuFor(null); setConfirmDel(m); }}>
                                  <RiDeleteBin6Line /> Delete
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="chat-composer">
                {replyTo && (
                  <div className="chat-replybar">
                    <span>Replying to <b>{replyTo.sender_name || (replyTo.sender_side === me.side ? "you" : "school")}</b>: {(replyTo.body || replyTo.attachment_name || "attachment").slice(0, 60)}</span>
                    <button onClick={() => setReplyTo(null)}><RiCloseLine /></button>
                  </div>
                )}
                {pending && (
                  <div className="chat-attachchip">
                    <RiImageLine /> <span>{pending.uploading ? `Uploading ${pending.name}…` : pending.result.name}</span>
                    {!pending.uploading && <button onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = ""; }}><RiCloseLine /></button>}
                  </div>
                )}
                <div className="chat-composer-row">
                  <input ref={fileRef} type="file" hidden onChange={onPickFile} accept="image/*,.pdf,.doc,.docx,.txt,.csv" />
                  <button className="chat-iconbtn" title="Attach file (max 2 MB)" onClick={() => fileRef.current?.click()}><RiAttachment2 /></button>
                  <textarea ref={taRef} className="ap-input" rows={1} placeholder={placeholder}
                    value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
                  <button className="chat-send" disabled={!canSend} onClick={onSend}><RiSendPlaneFill /> {sending ? "…" : "Send"}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---------- delete message confirmation ---------- */}
      {confirmDel && (
        <div className="chat-modal-overlay" onClick={() => setConfirmDel(null)}>
          <div className="chat-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="chat-modal-head"><b>Delete message</b><button className="chat-act" onClick={() => setConfirmDel(null)}><RiCloseLine /></button></div>
            <div className="chat-modal-body">
              <p style={{ margin: 0, fontSize: ".9rem", color: "var(--text-secondary,#6b7280)" }}>
                This removes the message for everyone in this chat. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="ap-btn ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                <button className="ap-btn red" onClick={() => onDelete(confirmDel.id)}><RiDeleteBin6Line /> Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- new chat / contacts picker ---------- */}
      {picker && (
        <div className="chat-modal-overlay" onClick={() => setPicker(null)}>
          <div className="chat-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chat-modal-head"><b>New chat</b><button className="chat-act" onClick={() => setPicker(null)}><RiCloseLine /></button></div>
            <div style={{ padding: "10px 12px 0" }}>
              <input className="ap-input" autoFocus placeholder="Search contacts…" value={picker.query} onChange={(e) => setPicker((p) => ({ ...p, query: e.target.value }))} />
            </div>
            <div className="chat-modal-body">
              {picker.loading ? <div style={{ padding: 16, textAlign: "center", color: "#9ca3af" }}>Loading contacts…</div> : null}
              {!picker.loading && filteredContacts.length === 0 ? <div style={{ padding: 16, textAlign: "center", color: "#9ca3af" }}>No matching contacts.</div> : null}
              {filteredContacts.map((c) => (
                <div key={c.key} className="chat-contact" onClick={() => openThread(c)}>
                  <div className="cc-ic">{c.kind === "admin" ? <RiCustomerService2Line /> : <RiGroupLine />}</div>
                  <div><div className="cc-title">{c.title}</div>{c.subtitle && <div className="cc-sub">{c.subtitle}</div>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
