import { useEffect, useState, type FormEvent } from "react";
import { api, websocketUrl, type Conversation, type Message } from "./api";

type RealtimeEvent = { type: string; data?: Message; room_id?: number; detail?: string };
function mergeMessage(current: Message[], incoming: Message): Message[] {
  return current.some((message) => message.id === incoming.id) ? current : [...current, incoming];
}

export function PrivateConversation({ token, conversation, currentUserId }: { token: string; conversation: Conversation; currentUserId: number }) {
  const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api.conversationMessages(token, conversation.conversation_id)
      .then((result) => { if (active) setMessages(result.messages); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load conversation."); });
    const socket = new WebSocket(websocketUrl(token));
    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as RealtimeEvent;
        if (incoming.type === "private_message" && incoming.data?.conversation_id === conversation.conversation_id) {
          setMessages((items) => mergeMessage(items, incoming.data!));
        }
      } catch { /* Ignore malformed event frames. */ }
    };
    return () => { active = false; socket.close(); };
  }, [token, conversation.conversation_id]);

  async function send(event: FormEvent) {
    event.preventDefault(); const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api.sendPrivateMessage(token, conversation.other_user_id, text);
      setMessages((items) => mergeMessage(items, result.data)); setDraft("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send message."); }
    finally { setBusy(false); }
  }
  return <section className="private-chat"><div className="private-chat-messages message-list" aria-live="polite">
    {messages.map((message) => <article key={message.id} className={`message ${message.sender_id === currentUserId ? "mine" : ""}`}><p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small></article>)}
    {messages.length === 0 && <div className="empty">No messages yet. Send the first one.</div>}
  </div>{error && <p role="alert" className="error">{error}</p>}
    <form className="composer" onSubmit={send}><input aria-label="Private message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder={`Message ${conversation.other_user ?? "user"}…`} /><button className="primary" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send"}</button></form>
  </section>;
}

export function RoomConversation({ token, roomId, currentUserId }: { token: string; roomId: number; currentUserId: number }) {
  const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api.roomMessages(token, roomId).then((result) => { if (active) setMessages(result.messages); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load room messages."); });
    const socket = new WebSocket(websocketUrl(token));
    socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe_room", room_id: roomId }));
    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as RealtimeEvent;
        if (incoming.type === "room_message" && incoming.room_id === roomId && incoming.data) setMessages((items) => mergeMessage(items, incoming.data!));
        if (incoming.type === "error") setError(incoming.detail ?? "Room subscription failed.");
      } catch { /* Ignore malformed event frames. */ }
    };
    return () => { active = false; socket.close(); };
  }, [token, roomId]);
  async function send(event: FormEvent) {
    event.preventDefault(); const text = draft.trim(); if (!text || busy) return;
    setBusy(true); setError("");
    try { const result = await api.sendRoomMessage(token, roomId, text); setMessages((items) => mergeMessage(items, result.data)); setDraft(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send room message."); }
    finally { setBusy(false); }
  }
  return <section className="private-chat"><div className="private-chat-messages message-list" aria-live="polite">
    {messages.map((message) => <article key={message.id} className={`message ${message.sender_id === currentUserId ? "mine" : ""}`}><p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small></article>)}
    {messages.length === 0 && <div className="empty">No messages in this room yet.</div>}
  </div>{error && <p role="alert" className="error">{error}</p>}
    <form className="composer" onSubmit={send}><input aria-label="Room message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Write a room message…" /><button className="primary" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send"}</button></form>
  </section>;
}
