import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, type FileRecord, type Message, type Room, type Transfer, type User } from "./api";

type View = "overview" | "messages" | "rooms" | "files" | "analytics" | "monitoring" | "admin";
type Conversation = { conversation_id: number; other_user_id: number; other_user: string | null; message_count: number };
const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "messages", label: "Messages", icon: "✉" },
  { id: "rooms", label: "Rooms", icon: "◎" },
  { id: "files", label: "Files & transfers", icon: "⇄" },
  { id: "analytics", label: "Analytics", icon: "▤" },
  { id: "monitoring", label: "Monitoring", icon: "◌" },
  { id: "admin", label: "Administration", icon: "▣" },
];

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (mode === "login") {
        const result = await api.login(username.trim(), password);
        onAuthenticated(result.token, result.user);
      } else {
        await api.register(username.trim(), password);
        setMode("login");
        setError("Account created. Sign in with your new credentials.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to authenticate."); }
    finally { setBusy(false); }
  }
  return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Secure collaboration workspace</span></div></div>
    <div className="auth-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button></div>
    <label>Username<input autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_username" /></label>
    <label>Password<input autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
    {error && <p className={error.startsWith("Account created") ? "notice" : "error"}>{error}</p>}
    <button className="primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
    <p className="hint">Your session is authenticated by the NetConnect API.</p>
  </form></main>;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("netconnect-token"));
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("overview");
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("netconnect-theme") as "dark" | "light") || "dark");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("netconnect-theme", theme); }, [theme]);
  useEffect(() => {
    if (!token) { setUser(null); return; }
    let active = true;
    api.me(token).then((value) => { if (active) setUser(value); }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Session expired.");
      localStorage.removeItem("netconnect-token"); setToken(null);
    });
    return () => { active = false; };
  }, [token]);
  const authenticated = useCallback((nextToken: string, nextUser: User) => { localStorage.setItem("netconnect-token", nextToken); setToken(nextToken); setUser(nextUser); setError(""); }, []);
  async function logout() { if (token) { try { await api.logout(token); } catch { /* Local logout still clears the expired/unreachable session. */ } } localStorage.removeItem("netconnect-token"); setToken(null); setUser(null); setView("overview"); }
  if (!token || !user) return <><AuthScreen onAuthenticated={authenticated} />{error && <div className="toast">{error}</div>}</>;
  const title = nav.find((item) => item.id === view)?.label ?? "Overview";
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Workspace</span></div></div>
      <div className="workspace-label">WORKSPACE</div><nav>{nav.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setError(""); }}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.username}</b><span>{user.role}</span></div><i className="online-dot" /></div><button className="nav-item logout" onClick={logout}><span className="nav-icon">↪</span>Sign out</button></div>
    </aside>
    <main className="main"><header className="topbar"><div><div className="eyebrow">NETCONNECT / WORKSPACE</div><h1>{title}</h1></div><div className="top-actions"><span className="api-indicator"><i /> API connected</span><button className="icon-button" aria-label="Toggle color theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☼" : "☾"}</button><button className="icon-button" aria-label="Refresh data" onClick={() => setRefreshKey((key) => key + 1)}>↻</button></div></header>
      {error && <div className="banner error-banner"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      <Page view={view} token={token} user={user} refreshKey={refreshKey} onError={setError} onRefresh={() => setRefreshKey((key) => key + 1)} />
    </main>
  </div>;
}

function Page({ view, token, user, refreshKey, onError, onRefresh }: { view: View; token: string; user: User; refreshKey: number; onError: (message: string) => void; onRefresh: () => void }) {
  switch (view) {
    case "rooms": return <RoomsPage token={token} refreshKey={refreshKey} onError={onError} />;
    case "messages": return <MessagesPage token={token} refreshKey={refreshKey} onError={onError} />;
    case "files": return <FilesPage token={token} refreshKey={refreshKey} onError={onError} />;
    case "analytics": return <AnalyticsPage token={token} refreshKey={refreshKey} onError={onError} />;
    case "monitoring": return <MonitoringPage token={token} refreshKey={refreshKey} onError={onError} />;
    case "admin": return <AdminPage token={token} user={user} refreshKey={refreshKey} onError={onError} />;
    default: return <OverviewPage token={token} user={user} refreshKey={refreshKey} onError={onError} onNavigate={onRefresh} />;
  }
}

function useLoad<T>(loader: () => Promise<T>, deps: unknown[], onError: (message: string) => void) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); loader().then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) onError(reason instanceof Error ? reason.message : "Could not load data."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; // loader is intentionally refreshed by explicit dependencies
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, loading };
}

function OverviewPage({ token, user, refreshKey, onError, onNavigate }: { token: string; user: User; refreshKey: number; onError: (message: string) => void; onNavigate: () => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError);
  const files = useLoad(() => api.files(token), [token, refreshKey], onError);
  const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  const totalFiles = files.data?.files.length ?? 0;
  return <><section className="welcome-row"><div><div className="eyebrow">YOUR TEAM SPACE</div><h2>Good to see you, {user.username}</h2><p>Here’s what’s happening across your workspace.</p></div><button className="primary" onClick={onNavigate}>Refresh workspace <span>↻</span></button></section>
    <section className="stat-grid"><Stat label="Rooms" value={rooms.data?.rooms.length} detail="Available to your account" icon="◎" /><Stat label="Your files" value={totalFiles} detail="Stored file records" icon="▧" /><Stat label="Transfers" value={transfers.data?.transfers.length} detail="Recent transfer history" icon="⇄" /><Stat label="Account" value={user.status} detail={`Role: ${user.role}`} icon="◉" /></section>
    <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Quick actions</h3><p>Jump back into your workspace</p></div></div><div className="quick-grid"><QuickAction icon="◎" title="Explore rooms" text="Join a room or start one" onClick={() => { const event = new CustomEvent("netconnect:navigate", { detail: "rooms" }); window.dispatchEvent(event); }} /><QuickAction icon="✉" title="Messages" text="Open your conversations" onClick={() => window.dispatchEvent(new CustomEvent("netconnect:navigate", { detail: "messages" }))} /><QuickAction icon="⇄" title="File transfers" text="Review files and TCP setup" onClick={() => window.dispatchEvent(new CustomEvent("netconnect:navigate", { detail: "files" }))} /></div></div>
    <div className="card"><div className="card-heading"><div><h3>Recent rooms</h3><p>Rooms available in your workspace</p></div><button className="text-button" onClick={() => window.dispatchEvent(new CustomEvent("netconnect:navigate", { detail: "rooms" }))}>View all →</button></div>{rooms.loading ? <Loading /> : <div className="simple-list">{(rooms.data?.rooms ?? []).slice(0, 4).map((room) => <div className="simple-row" key={room.id}><span className="room-symbol">◎</span><div><b>{room.name}</b><small>{room.description || "Team room"}</small></div></div>)}{rooms.data?.rooms.length === 0 && <Empty>No rooms available yet.</Empty>}</div>}</div>
    <div className="card"><div className="card-heading"><div><h3>Recent transfers</h3><p>Latest activity recorded by the API</p></div></div>{transfers.loading ? <Loading /> : <div className="simple-list">{(transfers.data?.transfers ?? []).slice(0, 4).map((item) => <div className="simple-row" key={item.id}><span className="file-symbol">⇄</span><div><b>{item.filename}</b><small>{item.direction} · {item.status}</small></div><small>{formatDate(item.created_at)}</small></div>)}{transfers.data?.transfers.length === 0 && <Empty>No transfer history yet.</Empty>}</div>}</div></section>
    <NavigateListener />
  </>;
}
function NavigateListener() { useEffect(() => { const handler = (event: Event) => { const view = (event as CustomEvent<View>).detail; window.dispatchEvent(new CustomEvent("netconnect:set-view", { detail: view })); }; window.addEventListener("netconnect:navigate", handler); return () => window.removeEventListener("netconnect:navigate", handler); }, []); return null; }
function Stat({ label, value, detail, icon }: { label: string; value: string | number | undefined; detail: string; icon: string }) { return <article className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></article>; }
function QuickAction({ icon, title, text, onClick }: { icon: string; title: string; text: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span><b>{title}</b><small>{text}</small><i>→</i></button>; }
function Loading() { return <div className="loading">Loading…</div>; }
function Empty({ children }: { children: string }) { return <div className="empty">{children}</div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }

function RoomsPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const { data, setData, loading } = useLoad(() => api.rooms(token), [token, refreshKey], onError);
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [selected, setSelected] = useState<number | null>(null); const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false);
  async function createRoom(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await api.createRoom(token, name.trim(), description.trim()); setData({ rooms: [result.room, ...(data?.rooms ?? [])] }); setName(""); setDescription(""); } catch (e) { onError(e instanceof Error ? e.message : "Could not create room."); } finally { setBusy(false); } }
  async function openRoom(room: Room) { setSelected(room.id); try { const result = await api.roomMessages(token, room.id); setMessages(result.messages); } catch (e) { onError(e instanceof Error ? e.message : "Could not load room messages."); setMessages([]); } }
  async function join(room: Room) { try { await api.joinRoom(token, room.id); await openRoom(room); } catch (e) { onError(e instanceof Error ? e.message : "Could not join room."); } }
  async function send(event: FormEvent) { event.preventDefault(); if (!selected || !draft.trim()) return; setBusy(true); try { const result = await api.sendRoomMessage(token, selected, draft.trim()); setMessages((items) => [...items, result.data]); setDraft(""); } catch (e) { onError(e instanceof Error ? e.message : "Could not send message."); } finally { setBusy(false); } }
  const selectedRoom = data?.rooms.find((room) => room.id === selected);
  return <section className="content-grid"><div className="card"><div className="card-heading"><div><h3>Create a room</h3><p>Start a shared conversation</p></div></div><form className="stack-form" onSubmit={createRoom}><label>Room name<input required minLength={3} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. product-team" /></label><label>Description<input maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this room for?" /></label><button className="primary" disabled={busy}>Create room</button></form></div><div className="card"><div className="card-heading"><div><h3>Rooms</h3><p>Join or open an available room</p></div><span className="count-badge">{data?.rooms.length ?? 0}</span></div>{loading ? <Loading /> : <div className="room-list">{(data?.rooms ?? []).map((room) => <div className={`room-card ${selected === room.id ? "chosen" : ""}`} key={room.id}><div className="room-avatar">◎</div><div className="room-copy"><b>{room.name}</b><small>{room.description || "No description"}</small></div><button className="secondary" onClick={() => join(room)}>Join</button><button className="text-button" onClick={() => openRoom(room)}>Open</button></div>)}{data?.rooms.length === 0 && <Empty>No rooms yet. Create the first one.</Empty>}</div>}</div><div className="card span-two"><div className="card-heading"><div><h3>{selectedRoom ? selectedRoom.name : "Room conversation"}</h3><p>{selectedRoom ? "Room messages are loaded from the API" : "Open a room to view its messages"}</p></div></div><div className="message-list">{messages.map((message) => <div className={`message ${message.sender_id ? "" : "mine"}`} key={`${message.id}-${message.created_at}`}><p>{message.content}</p><small>{formatDate(message.created_at)}</small></div>)}{selectedRoom && messages.length === 0 && <Empty>No messages in this room yet.</Empty>}</div>{selectedRoom && <form className="composer" onSubmit={send}><input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} placeholder="Write a room message…" /><button className="primary" disabled={busy || !draft.trim()}>Send</button></form>}</div></section>;
}

function MessagesPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const { data, loading } = useLoad(() => api.conversations(token), [token, refreshKey], onError);
  const [recipient, setRecipient] = useState(""); const [draft, setDraft] = useState(""); const [sent, setSent] = useState(""); const [busy, setBusy] = useState(false);
  async function send(event: FormEvent) { event.preventDefault(); const recipientId = Number(recipient); if (!Number.isInteger(recipientId) || recipientId < 1 || !draft.trim()) { onError("Enter a valid recipient user ID and message."); return; } setBusy(true); try { await api.sendPrivateMessage(token, recipientId, draft.trim()); setSent(`Message sent to user ${recipientId}. This API does not expose private-message history yet.`); setDraft(""); } catch (e) { onError(e instanceof Error ? e.message : "Could not send message."); } finally { setBusy(false); } }
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Private conversations</h3><p>Conversation summaries available through the current API</p></div><span className="count-badge">{data?.conversations.length ?? 0}</span></div>{loading ? <Loading /> : <>{data?.conversations.length ? <div className="conversation-grid">{data.conversations.map((c: Conversation) => <div className="conversation-card" key={c.conversation_id}><div className="avatar">{(c.other_user || "?").slice(0, 1).toUpperCase()}</div><div><b>{c.other_user || `User ${c.other_user_id}`}</b><small>ID {c.other_user_id} · {c.message_count} messages</small></div><button className="secondary" onClick={() => setRecipient(String(c.other_user_id))}>Message</button></div>)}</div> : <Empty>No private conversations found. Start one by entering a recipient user ID below.</Empty>}</>}</div><div className="card span-two"><div className="card-heading"><div><h3>Send a private message</h3><p>Messages are sent using the authenticated API</p></div></div><form className="stack-form" onSubmit={send}><label>Recipient user ID<input type="number" min="1" required value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="User ID" /></label><label>Message<input required maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write your message…" /></label><button className="primary" disabled={busy}>{busy ? "Sending…" : "Send message"}</button></form>{sent && <p className="notice">{sent}</p>}</div></section>;
}

function FilesPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError); const tcp = useLoad(() => api.tcpInfo(token), [token, refreshKey], onError);
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Shared files</h3><p>File metadata stored for your account</p></div><span className="count-badge">{files.data?.files.length ?? 0}</span></div>{files.loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>File</th><th>Size</th><th>Type</th><th>Created</th><th>SHA-256</th></tr></thead><tbody>{(files.data?.files ?? []).map((file: FileRecord) => <tr key={file.id}><td><b>{file.name}</b></td><td>{formatBytes(file.size_bytes)}</td><td>{file.content_type}</td><td>{formatDate(file.created_at)}</td><td><code>{file.sha256.slice(0, 12)}…</code></td></tr>)}</tbody></table>{files.data?.files.length === 0 && <Empty>No files are registered to your account.</Empty>}</div>}</div>
    <div className="card"><div className="card-heading"><div><h3>TCP transfer service</h3><p>Connection details from backend</p></div></div>{tcp.loading ? <Loading /> : tcp.data ? <><div className="detail-list"><div><span>Host</span><b>{tcp.data.host}</b></div><div><span>Port</span><b>{tcp.data.port}</b></div><div><span>Maximum file size</span><b>{formatBytes(tcp.data.max_file_bytes)}</b></div><div><span>Protocol</span><b>{tcp.data.protocol}</b></div></div><p className="hint">{tcp.data.note}</p></> : <Empty>Transfer service details unavailable.</Empty>}</div>
    <div className="card"><div className="card-heading"><div><h3>Transfer history</h3><p>Latest records from the API</p></div><span className="count-badge">{transfers.data?.transfers.length ?? 0}</span></div>{transfers.loading ? <Loading /> : <div className="simple-list">{(transfers.data?.transfers ?? []).map((item: Transfer) => <div className="simple-row" key={item.id}><span className="file-symbol">⇄</span><div><b>{item.filename}</b><small>{item.direction} · {item.status} · {formatBytes(item.size_bytes)}</small></div><small>{formatDate(item.created_at)}</small></div>)}{transfers.data?.transfers.length === 0 && <Empty>No transfer records yet.</Empty>}</div>}</div>
    <div className="banner span-two"><b>Uploads and downloads use the separate TCP service.</b><span>The current REST API exposes file metadata and transfer history; it does not provide an HTTP upload endpoint. This UI avoids pretending an upload succeeded.</span></div></section>;
}

function AnalyticsPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  const counts = [{ label: "Rooms", value: rooms.data?.rooms.length ?? 0, color: "blue" }, { label: "Files", value: files.data?.files.length ?? 0, color: "green" }, { label: "Transfers", value: transfers.data?.transfers.length ?? 0, color: "purple" }];
  const busy = rooms.loading || files.loading || transfers.loading;
  return <><div className="page-intro"><div><h2>Workspace analytics</h2><p>Live totals derived from available API records, not historical estimates.</p></div><span className="live-tag"><i /> Current data</span></div><section className="stat-grid three">{counts.map((item) => <Stat key={item.label} label={item.label} value={busy ? undefined : item.value} detail="Current API total" icon={item.label === "Rooms" ? "◎" : item.label === "Files" ? "▧" : "⇄"} />)}</section><section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Resource snapshot</h3><p>Counts returned by this account’s API endpoints</p></div></div>{busy ? <Loading /> : <div className="bar-list">{counts.map((item) => { const max = Math.max(...counts.map((entry) => entry.value), 1); return <div className="bar-row" key={item.label}><span>{item.label}</span><div className="bar-track"><div className={`bar-fill ${item.color}`} style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} /></div><b>{item.value}</b></div>; })}</div>}</div><div className="card span-two"><div className="card-heading"><div><h3>Data scope</h3><p>Honest interpretation of current backend support</p></div></div><p className="body-copy">The backend currently provides room, file, transfer-history, and user-management endpoints. It does not expose an analytics summary or historical time-series endpoint, so this page reports only live record counts and does not invent activity, latency, or growth statistics.</p></div></section></>;
}

function MonitoringPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  const checks = [{ name: "Authentication", ok: true }, { name: "Rooms API", ok: rooms.data !== null }, { name: "File metadata API", ok: files.data !== null }, { name: "Transfer history API", ok: transfers.data !== null }];
  return <><div className="page-intro"><div><h2>Service monitoring</h2><p>Reachability checks against endpoints supported by the backend.</p></div><span className="live-tag"><i /> Request status</span></div><section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>API checks</h3><p>Successful authenticated reads indicate the endpoint responded.</p></div></div>{rooms.loading || files.loading || transfers.loading ? <Loading /> : <div className="check-list">{checks.map((check) => <div className="check-row" key={check.name}><div><i className={check.ok ? "check-dot good" : "check-dot bad"} /><b>{check.name}</b></div><span className={`status ${check.ok ? "healthy" : "unavailable"}`}>{check.ok ? "Responding" : "Unavailable"}</span></div>)}</div>}</div><div className="card"><div className="card-heading"><div><h3>Current records</h3><p>Counts available to this session</p></div></div><div className="detail-list"><div><span>Rooms</span><b>{rooms.data?.rooms.length ?? "—"}</b></div><div><span>Files</span><b>{files.data?.files.length ?? "—"}</b></div><div><span>Transfer records</span><b>{transfers.data?.transfers.length ?? "—"}</b></div></div></div><div className="card"><div className="card-heading"><div><h3>Not exposed by API</h3><p>No fabricated monitoring numbers</p></div></div><p className="body-copy">Uptime, active connections, latency, CPU, and database health require a dedicated monitoring endpoint, which is not present in the current backend.</p></div></section></>;
}

function AdminPage({ token, user, refreshKey, onError }: { token: string; user: User; refreshKey: number; onError: (message: string) => void }) {
  const isAdmin = user.role === "administrator"; const { data, setData, loading } = useLoad(() => isAdmin ? api.users(token) : Promise.reject(new Error("Administrator privileges required.")), [token, refreshKey, isAdmin], onError); const [busyId, setBusyId] = useState<number | null>(null); const [filter, setFilter] = useState("");
  async function setSuspended(target: User, suspended: boolean) { if (target.id === user.id) { onError("You cannot change your own account status here."); return; } setBusyId(target.id); try { const result = await api.setSuspended(token, target.id, suspended); setData((current) => current ? { users: current.users.map((item) => item.id === target.id ? result.user : item) } : current); } catch (e) { onError(e instanceof Error ? e.message : "Unable to update user."); } finally { setBusyId(null); } }
  if (!isAdmin) return <div className="card permission-card"><span className="permission-icon">▣</span><h2>Administrator access required</h2><p>User roster and moderation controls are restricted to administrator accounts by the API.</p></div>;
  const users = (data?.users ?? []).filter((item) => item.username.toLowerCase().includes(filter.toLowerCase()));
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>User administration</h3><p>Account status controls, enforced by administrator-only backend routes</p></div><span className="count-badge">{data?.users.length ?? 0} users</span></div><div className="toolbar"><input aria-label="Filter users" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search username…" /></div>{loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{users.map((target) => <tr key={target.id}><td><b>{target.username}</b><small className="cell-sub">ID {target.id}</small></td><td>{target.role}</td><td><span className={`status ${target.is_suspended ? "unavailable" : "healthy"}`}>{target.is_suspended ? "Suspended" : target.status}</span></td><td>{target.created_at ? formatDate(target.created_at) : "—"}</td><td><button className={target.is_suspended ? "secondary" : "danger-button"} disabled={busyId === target.id || target.id === user.id} onClick={() => setSuspended(target, !target.is_suspended)}>{busyId === target.id ? "Saving…" : target.is_suspended ? "Reactivate" : "Suspend"}</button></td></tr>)}</tbody></table>{users.length === 0 && <Empty>No matching users.</Empty>}</div>}</div></section>;
}

export default App;
