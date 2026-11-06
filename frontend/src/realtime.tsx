import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Message } from "./api";

export type RealtimeEvent = { type: string; data?: Message; room_id?: number; detail?: string };

/** Authenticated browser event bridge; the Python TCP server remains separate. */
export function useRealtime(token: string | null, onEvent: (event: RealtimeEvent) => void) {
  const callback = useRef(onEvent);
  useEffect(() => { callback.current = onEvent; }, [onEvent]);
  useEffect(() => {
    if (!token) return;
    const base = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/^http/, "ws").replace(/\/$/, "");
    const socket = new WebSocket(`${base}/api/v1/ws?token=${encodeURIComponent(token)}`);
    socket.onmessage = (event) => { try { callback.current(JSON.parse(event.data) as RealtimeEvent); } catch { /* Ignore malformed server events. */ } };
    return () => socket.close();
  }, [token]);
  return (roomId: number) => {
    // The returned callback dispatches a subscription to the current connection.
    window.dispatchEvent(new CustomEvent("netconnect:subscribe-room", { detail: roomId }));
  };
}

export function useRoomSocketSubscription(token: string | null, roomId: number | null, onEvent: (event: RealtimeEvent) => void) {
  const callback = useRef(onEvent);
  useEffect(() => { callback.current = onEvent; }, [onEvent]);
  useEffect(() => {
    if (!token || roomId === null) return;
    const base = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/^http/, "ws").replace(/\/$/, "");
    const socket = new WebSocket(`${base}/api/v1/ws?token=${encodeURIComponent(token)}`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe_room", room_id: roomId }));
    socket.onmessage = (event) => { try { callback.current(JSON.parse(event.data) as RealtimeEvent); } catch { /* Ignore malformed server events. */ } };
    return () => socket.close();
  }, [token, roomId]);
}

export function PrivateConversation({ token, conversationId, currentUserId }: { token: string; conversationId: number; currentUserId: number }) {
  const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; api.conversationMessages(token, conversationId).then((result) => { if (active) setMessages(result.messages); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load conversation."); }); return () => { active = false; }; }, [token, conversationId]);
  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/^http/, "ws").replace(/\/$/, "");
    const socket = new WebSocket(`${base}/api/v1/ws?token=${encodeURIComponent(token)}`);
    socket.onmessage = (event) => { try { const incoming = JSON.parse(event.data) as RealtimeEvent; if (incoming.type === "private_message" && incoming.data?.conversation_id === conversationId) setMessages((items) => items.some((item) => item.id === incoming.data!.id) ? items : [...items, incoming.data!]); } catch { /* Ignore malformed events. */ } };
    return () => socket.close();
  }, [token, conversationId]);
  async function send(event: FormEvent) { event.preventDefault(); const text = draft.trim(); if (!text || busy) return; setBusy(true); setError(""); try { const result = await api.sendPrivateMessage(token, messages[0]?.receiver_id ?? currentUserId, text); setMessages((items) => items.some((item) => item.id === result.data.id) ? items : [...items, result.data]); setDraft(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send message."); } finally { setBusy(false); } }
  return <section className="private-chat"><div className="private-chat-messages" aria-live="polite">{messages.map((message) => <article key={message.id} className={message.sender_id === currentUserId ? "message mine" : "message"}><p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small></article>)}</div>{error && <p role="alert" className="error">{error}</p>}<form className="composer" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Write a private message…" /><button className="primary" disabled={busy || !draft.trim()}>Send</button></form></section>;
}
