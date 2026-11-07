import { useEffect, useState, type FormEvent } from "react";
import { api, type Conversation, type FileRecord, type Message, type Room, type Transfer, type User } from "./api";
import { PrivateConversation, RoomConversation } from "./Chat";

type View = "overview" | "messages" | "rooms" | "files" | "analytics" | "monitoring" | "admin";
const navigation: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◫" }, { id: "messages", label: "Messages", icon: "✉" },
  { id: "rooms", label: "Rooms", icon: "◎" }, { id: "files", label: "Files & transfers", icon: "⇄" },
  { id: "analytics", label: "Analytics", icon: "▤" }, { id: "monitoring", label: "Monitoring", icon: "◌" },
  { id: "admin", label: "Administration", icon: "▣" },
];

function AuthScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login"); const [username, setUsername] = useState("");
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      if (mode === "login") { const result = await api.login(username.trim(), password); onLogin(result.token, result.user); }
      else { await api.register(username.trim(), password); setMode("login"); setMessage("Account created. Sign in with your credentials."); }
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Authentication failed."); }
    finally { setBusy(false); }
  }
  return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}><div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Secure collaboration workspace</span></div></div>
    <div className="auth-tabs"><button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button><button type="button" className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button></div>
    <label>Username<input autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {message && <p className={message.startsWith("Account created") ? "notice" : "error"}>{message}</p>}<button className="primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
  </form></main>;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("netconnect-token")); const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("overview"); const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("netconnect-theme") === "light" ? "light" : "dark");
  const [error, setError] = useState(""); const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("netconnect-theme", theme); }, [theme]);
  useEffect(() => { if (!token) { setUser(null); return; } let mounted = true; api.me(token).then((value) => { if (mounted) setUser(value); }).catch((reason: unknown) => { if (mounted) { setError(reason instanceof Error ? reason.message : "Session expired."); localStorage.removeItem("netconnect-token"); setToken(null); } }); return () => { mounted = false; }; }, [token]);
  function login(nextToken: string, nextUser: User) { localStorage.setItem("netconnect-token", nextToken); setToken(nextToken); setUser(nextUser); setError(""); }
  async function logout() { if (token) { try { await api.logout(token); } catch { /* Clear the local session even if offline. */ } } localStorage.removeItem("netconnect-token"); setToken(null); setUser(null); }
  if (!token || !user) return <><AuthScreen onLogin={login} />{error && <div className="toast">{error}</div>}</>;
  const title = navigation.find((item) => item.id === view)?.label ?? "Overview";
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">N</div><div><b>NetConnect</b><span>Workspace</span></div></div><div className="workspace-label">WORKSPACE</div>
    <nav>{navigation.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setError(""); }}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
    <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="user-info"><b>{user.username}</b><span>{user.role}</span></div><i className="online-dot" /></div><button className="nav-item logout" onClick={logout}>↪ Sign out</button></div>
  </aside><main className="main"><header className="topbar"><div><div className="eyebrow">NETCONNECT / WORKSPACE</div><h1>{title}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Toggle color theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☼" : "☾"}</button><button className="icon-button" aria-label="Refresh data" onClick={() => setRefreshKey((value) => value + 1)}>↻</button></div></header>
    {error && <div className="banner error-banner"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <Page view={view} token={token} user={user} refreshKey={refreshKey} onError={setError} onNavigate={setView} />
  </main></div>;
}

function Page({ view, token, user, refreshKey, onError, onNavigate }: { view: View; token: string; user: User; refreshKey: number; onError: (message: string) => void; onNavigate: (view: View) => void }) {
  if (view === "rooms") return <RoomsPage token={token} user={user} refreshKey={refreshKey} onError={onError} />;
  if (view === "messages") return <MessagesPage token={token} user={user} refreshKey={refreshKey} onError={onError} />;
  if (view === "files") return <FilesPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "admin") return <AdminPage token={token} user={user} refreshKey={refreshKey} onError={onError} />;
  if (view === "monitoring") return <MonitoringPage token={token} refreshKey={refreshKey} onError={onError} />;
  if (view === "analytics") return <AnalyticsPage token={token} refreshKey={refreshKey} onError={onError} />;
  return <OverviewPage token={token} user={user} refreshKey={refreshKey} onError={onError} onNavigate={onNavigate} />;
}

function useLoad<T>(loader: () => Promise<T>, deps: unknown[], onError: (message: string) => void) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); loader().then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) onError(reason instanceof Error ? reason.message : "Could not load data."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; };
  // Explicit dependencies supplied by each page include session and refresh state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, loading };
}
function Loading() { return <div className="loading">Loading…</div>; }
function Empty({ children }: { children: string }) { return <div className="empty">{children}</div>; }
function date(value: string) { const result = new Date(value); return Number.isNaN(result.getTime()) ? value : result.toLocaleString(); }
function formatBytes(value: number) { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`; }
function Stat({ label, value, detail, icon }: { label: string; value: string | number | undefined; detail: string; icon: string }) { return <article className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value ?? "—"}</strong><small>{detail}</small></article>; }

function OverviewPage({ token, user, refreshKey, onError, onNavigate }: { token: string; user: User; refreshKey: number; onError: (message: string) => void; onNavigate: (view: View) => void }) {
  const rooms = useLoad(() => api.rooms(token), [token, refreshKey], onError); const files = useLoad(() => api.files(token), [token, refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token, refreshKey], onError);
  return <><section className="welcome-row"><div><div className="eyebrow">YOUR TEAM SPACE</div><h2>Good to see you, {user.username}</h2><p>Rooms, collaboration and network file transfer in one workspace.</p></div><button className="primary" onClick={() => onNavigate("messages")}>Open messages →</button></section>
    <section className="stat-grid"><Stat label="Rooms" value={rooms.data?.rooms.length} detail="Available rooms" icon="◎" /><Stat label="Your files" value={files.data?.files.length} detail="Stored file records" icon="▧" /><Stat label="Transfers" value={transfers.data?.transfers.length} detail="Recorded history" icon="⇄" /><Stat label="Account" value={user.status} detail={`Role: ${user.role}`} icon="◉" /></section>
    <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Workspace actions</h3><p>Go to a working section</p></div></div><div className="quick-grid">{([['messages','✉','Private messages'],['rooms','◎','Group rooms'],['files','⇄','TCP files']] as const).map(([target, icon, label]) => <button key={target} className="quick-action" onClick={() => onNavigate(target)}><span>{icon}</span><b>{label}</b><small>Open workspace section</small></button>)}</div></div>
    <div className="card"><div className="card-heading"><div><h3>Rooms</h3><p>Available rooms</p></div><button className="text-button" onClick={() => onNavigate("rooms")}>View all →</button></div>{rooms.loading ? <Loading /> : <div className="simple-list">{(rooms.data?.rooms ?? []).slice(0,5).map((room) => <div className="simple-row" key={room.id}><span className="room-symbol">◎</span><div><b>{room.name}</b><small>{room.description || "Team room"}</small></div></div>)}{rooms.data?.rooms.length === 0 && <Empty>No rooms yet.</Empty>}</div>}</div>
    <div className="card"><div className="card-heading"><div><h3>Recent transfers</h3><p>Persisted transfer history</p></div></div>{transfers.loading ? <Loading /> : <div className="simple-list">{(transfers.data?.transfers ?? []).slice(0,5).map((item) => <div className="simple-row" key={item.id}><span className="file-symbol">⇄</span><div><b>{item.filename}</b><small>{item.direction} · {item.status}</small></div></div>)}{transfers.data?.transfers.length === 0 && <Empty>No transfer history yet.</Empty>}</div>}</div></section></>;
}

function MessagesPage({ token, user, refreshKey, onError }: { token: string; user: User; refreshKey: number; onError: (message: string) => void }) {
  const { data, loading } = useLoad(() => api.conversations(token), [token, refreshKey], onError);
  const [selected, setSelected] = useState<Conversation | null>(null); const [recipient, setRecipient] = useState(""); const [search, setSearch] = useState(""); const [results, setResults] = useState<Message[] | null>(null);
  async function findMessages(event: FormEvent) { event.preventDefault(); if (!search.trim()) { setResults(null); return; } try { setResults((await api.searchMessages(token, search.trim())).messages); } catch (reason) { onError(reason instanceof Error ? reason.message : "Search failed."); } }
  return <section className="content-grid"><div className="card"><div className="card-heading"><div><h3>Private conversations</h3><p>Only your conversations are listed</p></div><span className="count-badge">{data?.conversations.length ?? 0}</span></div>{loading ? <Loading /> : <div className="room-list">{(data?.conversations ?? []).map((conversation) => <button key={conversation.conversation_id} className={`room-card ${selected?.conversation_id === conversation.conversation_id ? "chosen" : ""}`} onClick={() => { setSelected(conversation); setResults(null); }}><span className="avatar">{(conversation.other_user ?? "?").slice(0,1).toUpperCase()}</span><span className="room-copy"><b>{conversation.other_user ?? `User ${conversation.other_user_id}`}</b><small>{conversation.message_count} messages</small></span></button>)}{data?.conversations.length === 0 && <Empty>No conversations yet.</Empty>}</div>}
    <form className="stack-form" onSubmit={(event) => { event.preventDefault(); const id = Number(recipient); if (!Number.isInteger(id) || id < 1) { onError("Enter a valid user ID."); return; } const existing = data?.conversations.find((item) => item.other_user_id === id); if (existing) setSelected(existing); else onError("Send the first message using the recipient form below; a conversation appears after it is sent."); }}><label>Open by recipient user ID<input type="number" min="1" value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label><button className="secondary">Open conversation</button></form>
    <form className="stack-form" onSubmit={async (event) => { event.preventDefault(); const id = Number(recipient); if (!Number.isInteger(id) || id < 1) { onError("Enter a valid recipient user ID."); return; } const text = window.prompt("Write your first message:"); if (!text?.trim()) return; try { await api.sendPrivateMessage(token, id, text.trim()); onError("Message sent. Select the conversation after refreshing the list."); } catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to send message."); } }}><button className="text-button">Start a new private conversation</button></form>
  </div><div className="card"><div className="card-heading"><div><h3>{selected ? selected.other_user ?? `User ${selected.other_user_id}` : "Conversation"}</h3><p>Private history and live updates via authenticated WebSocket</p></div></div>
    {selected ? <PrivateConversation key={selected.conversation_id} token={token} conversation={selected} currentUserId={user.id} /> : <Empty>Select a conversation to view its history and chat in real time.</Empty>}
  </div><div className="card span-two"><div className="card-heading"><div><h3>Search your private messages</h3><p>Search is restricted to conversations involving your account</p></div></div><form className="composer" onSubmit={findMessages}><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Search message text…" /><button className="secondary">Search</button></form>{results && <div className="message-list">{results.map((message) => <article className="message" key={message.id}><p>{message.content}</p><small>{date(message.created_at)}</small></article>)}{results.length === 0 && <Empty>No matching messages.</Empty>}</div>}</div></section>;
}

function RoomsPage({ token, user, refreshKey, onError }: { token: string; user: User; refreshKey: number; onError: (message: string) => void }) {
  const { data, setData, loading } = useLoad(() => api.rooms(token), [token, refreshKey], onError); const [selected, setSelected] = useState<Room | null>(null); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await api.createRoom(token,name.trim(),description.trim()); setData({ rooms: [result.room,...(data?.rooms ?? [])] }); setName(""); setDescription(""); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not create room."); } finally { setBusy(false); } }
  async function join(room: Room) { try { await api.joinRoom(token,room.id); setSelected(room); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not join room."); } }
  return <section className="content-grid"><div className="card"><div className="card-heading"><div><h3>Create a room</h3><p>Room membership is enforced by the API</p></div></div><form className="stack-form" onSubmit={create}><label>Room name<input required minLength={3} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<input maxLength={255} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="primary" disabled={busy}>Create room</button></form></div>
    <div className="card"><div className="card-heading"><div><h3>Communication rooms</h3><p>Join to read and send messages</p></div></div>{loading ? <Loading /> : <div className="room-list">{(data?.rooms ?? []).map((room) => <div className="room-card" key={room.id}><div className="room-copy"><b>{room.name}</b><small>{room.description || "No description"} · {room.member_count ?? 0} members</small></div><button className="secondary" onClick={() => join(room)}>Join & open</button></div>)}{data?.rooms.length === 0 && <Empty>No rooms yet.</Empty>}</div>}</div>
    <div className="card span-two"><div className="card-heading"><div><h3>{selected?.name ?? "Room chat"}</h3><p>{selected ? "Real-time room events require an authenticated room membership" : "Join a room to open its chat"}</p></div></div>{selected ? <RoomConversation key={selected.id} token={token} roomId={selected.id} currentUserId={user.id} /> : <Empty>Join a room to load message history and chat.</Empty>}</div></section>;
}

function FilesPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) {
  const files = useLoad(() => api.files(token), [token,refreshKey], onError); const transfers = useLoad(() => api.transfers(token), [token,refreshKey], onError); const tcp = useLoad(() => api.tcpInfo(token), [token,refreshKey], onError);
  return <section className="content-grid"><div className="card span-two"><div className="card-heading"><div><h3>Your files</h3><p>Files registered by the TCP file-transfer service</p></div></div>{files.loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Size</th><th>Type</th><th>Created</th></tr></thead><tbody>{(files.data?.files ?? []).map((file: FileRecord) => <tr key={file.id}><td>{file.name}</td><td>{formatBytes(file.size_bytes)}</td><td>{file.content_type}</td><td>{date(file.created_at)}</td></tr>)}</tbody></table>{files.data?.files.length === 0 && <Empty>No files registered.</Empty>}</div>}</div>
    <div className="card"><h3>TCP transfer service</h3>{tcp.data ? <div className="detail-list"><div><span>Host</span><b>{tcp.data.host}</b></div><div><span>Port</span><b>{tcp.data.port}</b></div><div><span>Limit</span><b>{formatBytes(tcp.data.max_file_bytes)}</b></div></div> : <Loading />}<p className="hint">Actual bytes use the separate TCP service, not an HTTP upload mock.</p></div>
    <div className="card"><h3>Transfer history</h3>{transfers.loading ? <Loading /> : (transfers.data?.transfers ?? []).map((item: Transfer) => <div className="simple-row" key={item.id}><div><b>{item.filename}</b><small>{item.direction} · {item.status} · {formatBytes(item.size_bytes)}</small></div></div>)}</div></section>;
}

function AdminPage({ token, user, refreshKey, onError }: { token: string; user: User; refreshKey: number; onError: (message: string) => void }) {
  const isAdmin = user.role === "administrator"; const { data, setData, loading } = useLoad(() => isAdmin ? api.users(token) : Promise.reject(new Error("Administrator privileges required.")), [token,refreshKey,isAdmin], onError); const [filter, setFilter] = useState("");
  if (!isAdmin) return <div className="card permission-card"><h2>Administrator access required</h2><p>Backend role checks protect user management.</p></div>;
  async function suspend(target: User) { try { const response = await api.setSuspended(token,target.id,!target.is_suspended); setData((current) => current ? {users:current.users.map((item) => item.id === target.id ? response.user : item)} : current); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not update user."); } }
  const users = (data?.users ?? []).filter((item) => item.username.toLowerCase().includes(filter.toLowerCase()));
  return <div className="card"><div className="card-heading"><div><h3>User administration</h3><p>Suspension actions are enforced by administrator-only API routes</p></div><span className="count-badge">{data?.users.length ?? 0}</span></div><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search username…" />{loading ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map((target) => <tr key={target.id}><td>{target.username}</td><td>{target.role}</td><td>{target.is_suspended ? "Suspended" : target.status}</td><td><button className="secondary" disabled={target.id === user.id} onClick={() => suspend(target)}>{target.is_suspended ? "Reactivate" : "Suspend"}</button></td></tr>)}</tbody></table></div>}</div>;
}
function MonitoringPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) { const rooms = useLoad(() => api.rooms(token),[token,refreshKey],onError); const files = useLoad(() => api.files(token),[token,refreshKey],onError); const transfers = useLoad(() => api.transfers(token),[token,refreshKey],onError); return <section className="stat-grid"><Stat label="Rooms API" value={rooms.loading ? undefined : "Responding"} detail="Authenticated read" icon="◎" /><Stat label="Files API" value={files.loading ? undefined : "Responding"} detail="Authenticated read" icon="▧" /><Stat label="Transfer history" value={transfers.data?.transfers.length} detail="Records returned by API" icon="⇄" /><div className="banner span-two">Server uptime, live TCP peers, and byte counters are not supplied by an API endpoint yet; no synthetic measurements are shown.</div></section>; }
function AnalyticsPage({ token, refreshKey, onError }: { token: string; refreshKey: number; onError: (message: string) => void }) { const rooms = useLoad(() => api.rooms(token),[token,refreshKey],onError); const files = useLoad(() => api.files(token),[token,refreshKey],onError); const transfers = useLoad(() => api.transfers(token),[token,refreshKey],onError); return <section className="stat-grid"><Stat label="Rooms" value={rooms.data?.rooms.length} detail="Current API total" icon="◎" /><Stat label="Files" value={files.data?.files.length} detail="Current API total" icon="▧" /><Stat label="Transfers" value={transfers.data?.transfers.length} detail="Current API total" icon="⇄" /><div className="banner span-two">Counts are live API records; historical analytics are not exposed by the current backend.</div></section>; }
