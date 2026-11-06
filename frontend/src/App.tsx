import { useEffect, useState, type FormEvent } from "react";
import { api, type FileRecord, type Message, type Room, type Transfer, type User } from "./api";

type View = "overview" | "messages" | "rooms" | "files" | "analytics" | "monitoring" | "admin";
type Conversation = { conversation_id: number; other_user_id: number; other_user: string | null; message_count: number };
const navigation: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◫" }, { id: "messages", label: "Messages", icon: "✉" },
  { id: "rooms", label: "Rooms", icon: "◎" }, { id: "files", label: "Files & transfers", icon: "⇄" },
  { id: "analytics", label: "Analytics", icon: "▤" }, { id: "monitoring", label: "Monitoring", icon: "◌" },
  { id: "admin", label: "Administration", icon: "▣" },
];

function AuthScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      if (mode === "login") { const result = await api.login(username.trim(), password); onLogin(result.token, result.user); }
      else { await api.register(username.trim(), password); setMode("login"); setMessage("Account created. Sign in with your credentials."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Authentication failed."); }
    finally { setBusy(false); }
  }
  return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Secure collaboration workspace</span></div></div>
    <div className="auth-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button></div>
    <label>Username<input autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {message && <p className={message.startsWith("Account created") ? "notice" : "error"}>{message}</p>}
    <button className="primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
    <p className="hint">Your session is authenticated by the NetConnect API.</p>
  </form></main>;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("netconnect-token"));
  const [user, setUser] = useState<User | null>(null); const [view, setView] = useState<View>("overview");
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("netconnect-theme") === "light" ? "light" : "dark");
  const [error, setError] = useState(""); const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("netconnect-theme", theme); }, [theme]);
  useEffect(() => {
    const navigate = (event: Event) => { const destination = (event as CustomEvent<View>).detail; if (navigation.some((item) => item.id === destination)) setView(destination); };
    window.addEventListener("netconnect:navigate", navigate);
    return () => window.removeEventListener("netconnect:navigate", navigate);
  }, []);
  useEffect(() => {
    if (!token) { setUser(null); return; }
    let mounted = true;
    api.me(token).then((value) => { if (mounted) setUser(value); }).catch((reason: unknown) => {
      if (!mounted) return; setError(reason instanceof Error ? reason.message : "Session expired.");
      localStorage.removeItem("netconnect-token"); setToken(null);
    });
    return () => { mounted = false; };
  }, [token]);
  function login(nextToken: string, nextUser: User) { localStorage.setItem("netconnect-token", nextToken); setToken(nextToken); setUser(nextUser); setError(""); }
  async function logout() { if (token) { try { await api.logout(token); } catch { /* Clear local session even if the API is unavailable. */ } } localStorage.removeItem("netconnect-token"); setToken(null); setUser(null); setView("overview"); }
  if (!token || !user) return <><AuthScreen onLogin={login} />{error && <div className="toast">{error}</div>}</>;
  const title = navigation.find((item) => item.id === view)?.label ?? "Overview";
  return <div className="app-shell"><aside className="sidebar">
    <div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Workspace</span></div></div><div className="workspace-label">WORKSPACE</div>
    <nav>{navigation.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setError(""); }}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
    <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.username}</b><span>{user.role}</span></div><i className="online-dot" /></div><button className="nav-item logout" onClick={logout}><span className="nav-icon">↪</span>Sign out</button></div>
  </aside><main className="main"><header className="topbar"><div><div className="eyebrow">NETCONNECT / WORKSPACE</div><h1>{title}</h1></div><div className="top-actions"><span className="api-indicator"><i /> API connected</span><button className="icon-button" aria-label="Toggle color theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☼" : "☾"}</button><button className="icon-button" aria-label="Refresh data" onClick={() => setRefreshKey((key) => key + 1)}>↻</button></div></header>
    {error && <div className="banner error-banner"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <Page view={view} token={token} user={user} refreshKey={refreshKey} onError={setError} onNavigate={setView} />
  </main></div>;
}

function Page({ view, token, user, refreshKey, onError, onNavigate }: { view: View; token: string; user: User; refreshKey: number; onError: (message: string) => void; onNavigate: (view: View) => void }) {
  if (view === "rooms") return <RoomsPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "messages") return <MessagesPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "files") return <FilesPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "analytics") return <AnalyticsPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "monitoring") return <MonitoringPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "admin") return <AdminPage token={token} user={user} refreshKey={refreshKey} onError={onError} />;
  return <OverviewPage token={token} user={user} refreshKey={refreshKey} onError={onError} onNavigate={onNavigate} />;
}

function useLoad<T>(loader: () => Promise<T>, deps: unknown[], onError: (message: string) => void) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let mounted = true; setLoading(true); loader().then((result) => { if (mounted) setData(result); }).catch((reason: unknown) => { if (mounted) onError(reason instanceof Error ? reason.message : "Could not load data."); }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; };
  // The page supplies the explicit refresh/auth dependencies for this request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, loading };
}
function Loading() { return <div className="loading">Loading…</div>; }
function Empty({ children }: { children: string }) { return <div className="empty">{children}</div>; }
function date(value: string) { const result = new Date(value); return Number.isNaN(result.getTime()) ? value : result.toLocaleString(); }
function bytes(value: number) { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`; }
function Stat({ label, value, detail, icon }: { label: string; value: string | number | undefined; detail: string; icon: string }) { return <article className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></article>; }
function QuickAction({ icon, title, text, onClick }: { icon: string; title: string; text: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span><b>{title}</b><small>{text}</small><i>→</i></button>; }

function OverviewPage({ token, user, refreshKey, onError, onNavigate }: { token: string; user: User; refreshKey: number; onError: (message: string) => void; onNavigate: (view: View) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  return <><section className="welcome-row"><div><div className="eyebrow">YOUR TEAM SPACE</div><h2>Good to see you, {user.username}</h2><p>Here’s what’s happening across your workspace.</p></div><button className="primary" onClick={() => onNavigate("rooms")}>Explore workspace →</button></section>
    <section className="stat-grid"><Stat label="Rooms" value={rooms.data?.rooms.length} detail="Available rooms" icon="◎" /><Stat label="Your files" value={files.data?.files.length} detail="Stored file records" icon="▧" /><Stat label="Transfers" value={transfers.data?.transfers.length} detail="Transfer history records" icon="⇄" /><Stat label="Account" value={user.status} detail={`Role: ${user.role}`} icon="◉" /></section>
    <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Quick actions</h3><p>Jump into your workspace</p></div></div><div className="quick-grid"><QuickAction icon="◎" title="Explore rooms" text="Join a room or start one" onClick={() => onNavigate("rooms")} /><QuickAction icon="✉" title="Messages" text="View conversations" onClick={() => onNavigate("messages")} /><QuickAction icon="⇄" title="File transfers" text="Review files and TCP setup" onClick={() => onNavigate("files")} /></div></div>
    <div className="card"><div className="card-heading"><div><h3>Recent rooms</h3><p>Available in your workspace</p></div><button className="text-button" onClick={() => onNavigate("rooms")}>View all →</button></div>{rooms.loading ? <Loading /> : <div className="simple-list">{(rooms.data?.rooms ?? []).slice(0, 4).map((room) => <div className="simple-row" key={room.id}><span className="room-symbol">◎</span><div><b>{room.name}</b><small>{room.description || "Team room"}</small></div></div>)}{rooms.data?.rooms.length === 0 && <Empty>No rooms available yet.</Empty>}</div>}</div>
    <div className="card"><div className="card-heading"><div><h3>Recent transfers</h3><p>Latest activity recorded by the API</p></div></div>{transfers.loading ? <Loading /> : <div className="simple-list">{(transfers.data?.transfers ?? []).slice(0, 4).map((item) => <div className="simple-row" key={item.id}><span className="file-symbol">⇄</span><div><b>{item.filename}</b><small>{item.direction} · {item.status}</small></div><small>{date(item.created_at)}</small></div>)}{transfers.data?.transfers.length === 0 && <Empty>No transfer history yet.</Empty>}</div>}</div></section></>;
}

function RoomsPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const { data, setData, loading } = useLoad(() => api.rooms(token), [token, refreshKey], onError);
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [selected, setSelected] = useState<Room | null>(null); const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await api.createRoom(token, name.trim(), description.trim()); setData({ rooms: [result.room, ...(data?.rooms ?? [])] }); setName(""); setDescription(""); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not create room."); } finally { setBusy(false); } }
  async function open(room: Room) { setSelected(room); try { const result = await api.roomMessages(token, room.id); setMessages(result.messages); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load messages."); setMessages([]); } }
  async function join(room: Room) { try { await api.joinRoom(token, room.id); await open(room); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not join room."); } }
  async function send(event: FormEvent) { event.preventDefault(); if (!selected || !draft.trim()) return; setBusy(true); try { const result = await api.sendRoomMessage(token, selected.id, draft.trim()); setMessages((items) => [...items, result.data]); setDraft(""); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not send message."); } finally { setBusy(false); } }
  return <section className="content-grid"><div className="card"><div className="card-heading"><div><h3>Create a room</h3><p>Start a shared conversation</p></div></div><form className="stack-form" onSubmit={create}><label>Room name<input required minLength={3} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<input maxLength={255} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="primary" disabled={busy}>Create room</button></form></div>
    <div className="card"><div className="card-heading"><div><h3>Rooms</h3><p>Join or open an available room</p></div><span className="count-badge">{data?.rooms.length ?? 0}</span></div>{loading ? <Loading /> : <div className="room-list">{(data?.rooms ?? []).map((room) => <div className="room-card" key={room.id}><div className="room-avatar">◎</div><div className="room-copy"><b>{room.name}</b><small>{room.description || "No description"}</small></div><button className="secondary" onClick={() => join(room)}>Join</button><button className="text-button" onClick={() => open(room)}>Open</button></div>)}{data?.rooms.length === 0 && <Empty>No rooms yet. Create the first one.</Empty>}</div>}</div>
    <div className="card span-two"><div className="card-heading"><div><h3>{selected?.name ?? "Room conversation"}</h3><p>{selected ? "Messages from the room API" : "Open a room to view its messages"}</p></div></div><div className="message-list">{messages.map((message) => <div className="message" key={message.id}><p>{message.content}</p><small>{date(message.created_at)}</small></div>)}{selected && messages.length === 0 && <Empty>No messages in this room yet.</Empty>}</div>{selected && <form className="composer" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Write a room message…" /><button className="primary" disabled={busy || !draft.trim()}>Send</button></form>}</div></section>;
}

function MessagesPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const { data, loading } = useLoad(() => api.conversations(token), [token, refreshKey], onError); const [recipient, setRecipient] = useState(""); const [draft, setDraft] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function send(event: FormEvent) { event.preventDefault(); const recipientId = Number(recipient); if (!Number.isInteger(recipientId) || recipientId < 1 || !draft.trim()) { onError("Enter a valid recipient user ID and message."); return; } setBusy(true); try { await api.sendPrivateMessage(token, recipientId, draft.trim()); setNotice(`Message sent to user ${recipientId}. The current API does not expose private-message history.`); setDraft(""); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not send message."); } finally { setBusy(false); } }
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Private conversations</h3><p>Conversation summaries available through the API</p></div><span className="count-badge">{data?.conversations.length ?? 0}</span></div>{loading ? <Loading /> : data?.conversations.length ? <div className="conversation-grid">{data.conversations.map((conversation: Conversation) => <div className="conversation-card" key={conversation.conversation_id}><div className="avatar">{(conversation.other_user || "?").slice(0, 1).toUpperCase()}</div><div><b>{conversation.other_user || `User ${conversation.other_user_id}`}</b><small>ID {conversation.other_user_id} · {conversation.message_count} messages</small></div><button className="secondary" onClick={() => setRecipient(String(conversation.other_user_id))}>Message</button></div>)}</div> : <Empty>No conversations yet. Start one below.</Empty>}</div>
    <div className="card span-two"><div className="card-heading"><div><h3>Send a private message</h3><p>Send using the authenticated API</p></div></div><form className="stack-form" onSubmit={send}><label>Recipient user ID<input type="number" min="1" required value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label><label>Message<input required maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? "Sending…" : "Send message"}</button></form>{notice && <p className="notice">{notice}</p>}</div></section>;
}

function FilesPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError); const tcp = useLoad(() => api.tcpInfo(token), [token, refreshKey], onError);
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Shared files</h3><p>File metadata stored for your account</p></div><span className="count-badge">{files.data?.files.length ?? 0}</span></div>{files.loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>File</th><th>Size</th><th>Type</th><th>Created</th><th>SHA-256</th></tr></thead><tbody>{(files.data?.files ?? []).map((file: FileRecord) => <tr key={file.id}><td><b>{file.name}</b></td><td>{bytes(file.size_bytes)}</td><td>{file.content_type}</td><td>{date(file.created_at)}</td><td><code>{file.sha256.slice(0, 12)}…</code></td></tr>)}</tbody></table>{files.data?.files.length === 0 && <Empty>No files are registered to your account.</Empty>}</div>}</div>
    <div className="card"><div className="card-heading"><div><h3>TCP transfer service</h3><p>Connection details from backend</p></div></div>{tcp.loading ? <Loading /> : tcp.data ? <><div className="detail-list"><div><span>Host</span><b>{tcp.data.host}</b></div><div><span>Port</span><b>{tcp.data.port}</b></div><div><span>Max file size</span><b>{bytes(tcp.data.max_file_bytes)}</b></div><div><span>Protocol</span><b>{tcp.data.protocol}</b></div></div><p className="hint">{tcp.data.note}</p></> : <Empty>Transfer service details unavailable.</Empty>}</div>
    <div className="card"><div className="card-heading"><div><h3>Transfer history</h3><p>Latest records from the API</p></div><span className="count-badge">{transfers.data?.transfers.length ?? 0}</span></div>{transfers.loading ? <Loading /> : <div className="simple-list">{(transfers.data?.transfers ?? []).map((item: Transfer) => <div className="simple-row" key={item.id}><span className="file-symbol">⇄</span><div><b>{item.filename}</b><small>{item.direction} · {item.status} · {bytes(item.size_bytes)}</small></div><small>{date(item.created_at)}</small></div>)}{transfers.data?.transfers.length === 0 && <Empty>No transfer records yet.</Empty>}</div>}</div>
    <div className="banner span-two"><b>Uploads and downloads use the separate TCP service.</b><span>The current REST API exposes file metadata and transfer history, but no HTTP upload endpoint. This screen does not report a transfer unless the backend records one.</span></div></section>;
}

function AnalyticsPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  const rows = [{ label: "Rooms", value: rooms.data?.rooms.length ?? 0, color: "blue" }, { label: "Files", value: files.data?.files.length ?? 0, color: "green" }, { label: "Transfers", value: transfers.data?.transfers.length ?? 0, color: "purple" }]; const loading = rooms.loading || files.loading || transfers.loading; const max = Math.max(...rows.map((row) => row.value), 1);
  return <><div className="page-intro"><div><h2>Workspace analytics</h2><p>Current API counts only; no fabricated historical estimates.</p></div><span className="live-tag"><i /> Current data</span></div><section className="stat-grid three">{rows.map((row) => <Stat key={row.label} label={row.label} value={loading ? undefined : row.value} detail="Current API total" icon={row.label === "Rooms" ? "◎" : row.label === "Files" ? "▧" : "⇄"} />)}</section><section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Resource snapshot</h3><p>Counts returned by this account’s API endpoints</p></div></div>{loading ? <Loading /> : <div className="bar-list">{rows.map((row) => <div className="bar-row" key={row.label}><span>{row.label}</span><div className="bar-track"><div className={`bar-fill ${row.color}`} style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></div><b>{row.value}</b></div>)}</div>}</div><div className="card span-two"><div className="card-heading"><div><h3>Data scope</h3><p>Current backend capabilities</p></div></div><p className="body-copy">The backend exposes room, file, transfer-history, and user-management endpoints. It does not expose historical analytics or a time-series endpoint, so this page reports live record counts only.</p></div></section></>;
}

function MonitoringPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError); const loading = rooms.loading || files.loading || transfers.loading;
  const checks = [{ name: "Authentication", ok: true }, { name: "Rooms API", ok: rooms.data !== null }, { name: "File metadata API", ok: files.data !== null }, { name: "Transfer history API", ok: transfers.data !== null }];
  return <><div className="page-intro"><div><h2>Service monitoring</h2><p>Reachability checks against endpoints supported by the backend.</p></div><span className="live-tag"><i /> Request status</span></div><section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>API checks</h3><p>Successful authenticated reads indicate an endpoint responded.</p></div></div>{loading ? <Loading /> : <div className="check-list">{checks.map((check) => <div className="check-row" key={check.name}><div><i className={`check-dot ${check.ok ? "good" : "bad"}`} /><b>{check.name}</b></div><span className={`status ${check.ok ? "healthy" : "unavailable"}`}>{check.ok ? "Responding" : "Unavailable"}</span></div>)}</div>}</div><div className="card"><div className="card-heading"><div><h3>Current records</h3><p>Counts available to this session</p></div></div><div className="detail-list"><div><span>Rooms</span><b>{rooms.data?.rooms.length ?? "—"}</b></div><div><span>Files</span><b>{files.data?.files.length ?? "—"}</b></div><div><span>Transfers</span><b>{transfers.data?.transfers.length ?? "—"}</b></div></div></div><div className="card"><div className="card-heading"><div><h3>Not exposed by API</h3><p>No invented monitoring values</p></div></div><p className="body-copy">Uptime, active connections, latency, CPU, and database health require a dedicated monitoring endpoint, which the current backend does not expose.</p></div></section></>;
}

function AdminPage({ token, user, refreshKey, onError }: { token: string; user: User; refreshKey: number; onError: (message: string) => void }) {
  const isAdmin = user.role === "administrator"; const { data, setData, loading } = useLoad(() => isAdmin ? api.users(token) : Promise.reject(new Error("Administrator privileges required.")), [token, refreshKey, isAdmin], onError); const [busyId, setBusyId] = useState<number | null>(null); const [filter, setFilter] = useState("");
  async function changeStatus(target: User, suspended: boolean) { if (target.id === user.id) { onError("You cannot change your own account status here."); return; } setBusyId(target.id); try { const result = await api.setSuspended(token, target.id, suspended); setData((current) => current ? { users: current.users.map((item) => item.id === target.id ? result.user : item) } : current); } catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to update user."); } finally { setBusyId(null); } }
  if (!isAdmin) return <div className="card permission-card"><span className="permission-icon">▣</span><h2>Administrator access required</h2><p>User roster and moderation controls are restricted to administrator accounts by the API.</p></div>;
  const users = (data?.users ?? []).filter((item) => item.username.toLowerCase().includes(filter.toLowerCase()));
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>User administration</h3><p>Account status controls protected by administrator-only routes</p></div><span className="count-badge">{data?.users.length ?? 0} users</span></div><div className="toolbar"><input aria-label="Filter users" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search username…" /></div>{loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{users.map((target) => <tr key={target.id}><td><b>{target.username}</b><small className="cell-sub">ID {target.id}</small></td><td>{target.role}</td><td><span className={`status ${target.is_suspended ? "unavailable" : "healthy"}`}>{target.is_suspended ? "Suspended" : target.status}</span></td><td>{target.created_at ? date(target.created_at) : "—"}</td><td><button className={target.is_suspended ? "secondary" : "danger-button"} disabled={busyId === target.id || target.id === user.id} onClick={() => changeStatus(target, !target.is_suspended)}>{busyId === target.id ? "Saving…" : target.is_suspended ? "Reactivate" : "Suspend"}</button></td></tr>)}</tbody></table>{users.length === 0 && <Empty>No matching users.</Empty>}</div>}</div></section>;
}
