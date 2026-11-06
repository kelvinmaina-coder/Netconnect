export type User = {
  id: number;
  username: string;
  role: string;
  status: string;
  is_suspended: boolean;
  created_at?: string;
};

export type Room = {
  id: number;
  name: string;
  description?: string | null;
  [key: string]: unknown;
};

export type Message = {
  id: number;
  sender_id: number;
  content: string;
  created_at: string;
};

export type FileRecord = {
  id: number;
  name: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  created_at: string;
};

export type Transfer = {
  id: number;
  file_id: number | null;
  direction: "upload" | "download" | string;
  status: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
  completed_at: string | null;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

type RequestOptions = {
  method?: string;
  token?: string;
  body?: unknown;
};

async function request<T>(path: string, { method = "GET", token, body }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_BASE}. Check the backend and VITE_API_BASE_URL.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "detail" in payload
      ? String((payload as { detail: unknown }).detail)
      : typeof payload === "string" && payload.length > 0 ? payload : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

export const api = {
  login: (username: string, password: string) => request<{ token: string; user: User }>("/api/v1/auth/login", { method: "POST", body: { username, password } }),
  register: (username: string, password: string) => request<{ message: string; user: User }>("/api/v1/auth/register", { method: "POST", body: { username, password } }),
  me: (token: string) => request<User>("/api/v1/users/me", { token }),
  logout: (token: string) => request<{ message: string }>("/api/v1/auth/logout", { method: "POST", token }),
  users: (token: string) => request<{ users: User[] }>("/api/v1/admin/users", { token }),
  setSuspended: (token: string, userId: number, suspended: boolean) => request<{ user: User }>(`/api/v1/admin/users/${userId}/status`, { method: "PATCH", token, body: { is_suspended: suspended } }),
  rooms: (token: string) => request<{ rooms: Room[] }>("/api/v1/rooms", { token }),
  createRoom: (token: string, name: string, description: string) => request<{ room: Room }>("/api/v1/rooms", { method: "POST", token, body: { name, description } }),
  joinRoom: (token: string, roomId: number) => request<{ room: Room }>(`/api/v1/rooms/${roomId}/join`, { method: "POST", token }),
  roomMessages: (token: string, roomId: number) => request<{ messages: Message[] }>(`/api/v1/rooms/${roomId}/messages`, { token }),
  sendRoomMessage: (token: string, roomId: number, content: string) => request<{ data: Message }>(`/api/v1/rooms/${roomId}/messages`, { method: "POST", token, body: { content } }),
  conversations: (token: string) => request<{ conversations: Array<{ conversation_id: number; other_user_id: number; other_user: string | null; message_count: number }> }>("/api/v1/messages/conversations", { token }),
  sendPrivateMessage: (token: string, recipientId: number, content: string) => request<{ data: Message }>("/api/v1/messages/private", { method: "POST", token, body: { recipient_id: recipientId, content } }),
  files: (token: string) => request<{ files: FileRecord[] }>("/api/v1/files", { token }),
  transfers: (token: string) => request<{ transfers: Transfer[] }>("/api/v1/files/transfers", { token }),
  tcpInfo: (token: string) => request<{ host: string; port: number; max_file_bytes: number; protocol: string; note: string }>("/api/v1/files/tcp-info", { token }),
};
