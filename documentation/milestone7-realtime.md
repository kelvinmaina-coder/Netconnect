# Milestone 7 — browser real-time chat and access control

This change adds an authenticated WebSocket event bridge while keeping the standalone Python socket/thread TCP server as the actual TCP server. Connect with `ws://<api-host>/api/v1/ws?token=<session-token>`. The client may send `{\"type\":\"ping\"}` or subscribe to a joined room with `{\"type\":\"subscribe_room\",\"room_id\":1}`. Room subscriptions are checked against persisted membership. Private-message events are delivered only to the sender and recipient; room-message events are delivered only to sockets subscribed to that room.

REST additions:

- `GET /api/v1/messages/conversations/{conversation_id}/messages` — participant-only history, newest-limited response in chronological order.
- `GET /api/v1/messages/search?q=...` — caller's own private conversations only.
- `GET /api/v1/notifications` — notifications belonging to the authenticated user.
- `GET /health` — API process liveness, not a TCP-server health check.

Room history now checks room membership before exposing message content. CORS allows Vite localhost origins by default; set `NETCONNECT_CORS_ORIGINS` to a comma-separated exact origin allowlist for deployment. Do not use wildcard origins with credentials in production.

## Important limitations / remaining project work

The existing TCP echo server and TCP file-transfer service remain separate processes. This WebSocket is only a browser event transport; it does not replace TCP. Production TLS certificates/termination, profile picture storage, polls, message delivery/read receipts, full admin network statistics, server shutdown control, and end-to-end laboratory verification remain to be implemented. The WebSocket's token is supplied as a query parameter because browser WebSocket APIs cannot set Authorization headers; use HTTPS/WSS and short-lived tokens in deployments, and avoid logging query strings.
