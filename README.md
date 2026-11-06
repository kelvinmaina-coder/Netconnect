# NetConnect

NetConnect is an academic client-server network communication project. This first milestone establishes the Python TCP foundation: a standalone concurrent echo server, a length-prefixed JSON protocol, a small SQLite/SQLAlchemy schema, and automated tests.

## Milestone 1 status

Implemented in this milestone:

- A TCP server implemented with Python `socket` and `threading` (not FastAPI or WebSockets).
- A dedicated handler thread for each accepted client.
- Thread-safe connection tracking, unique connection IDs, peer addresses, per-client send locks, and connection counters.
- A welcome frame sent immediately on connection.
- Framed JSON messages using a 4-byte unsigned big-endian length prefix; partial reads and writes are handled.
- Each message is echoed to its originating client. On disconnect, remaining clients receive a `user_disconnected` event.
- Graceful server shutdown and configurable host, port, and maximum frame size.
- SQLAlchemy SQLite schema initialization and pytest coverage for concurrent clients, echo, welcome, disconnect notification, and shutdown.

## Requirements

- Python 3.10 or later
- pip

## Setup and run

```bash
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
python -m backend.database.init_db
python -m backend.server.echo_server
```

The server defaults to `127.0.0.1:9000`. To make it reachable from other computers on a trusted LAN, set `NETCONNECT_TCP_HOST=0.0.0.0` and choose a firewall-allowed port. Do not expose this development server directly to the public internet. TLS, authentication, rate limiting, and the production client protocol are later milestones.

Run tests from the repository root:

```bash
pytest -q
```

Run a small local client in another terminal:

```bash
python -m backend.server.tcp_client --host 127.0.0.1 --port 9000
```

Type a line and the client prints the server's echo. Enter `quit` to exit.

## TCP protocol (Milestone 1)

Each frame is `4-byte big-endian unsigned payload length` followed by that many UTF-8 bytes containing one JSON object. The maximum accepted frame size is configurable and defaults to 1 MiB. A connection receives a `welcome` JSON object immediately. Client frames are echoed as `echo` objects with their original JSON under `payload`. This is application-level request/response traffic over TCP; it is not an ICMP ping. See `documentation/architecture.md` and `backend/network/protocol.py`.

## Project structure

```text
backend/
  database/       SQLAlchemy models, SQLite session factory, initialization
  network/        framed TCP protocol helpers
  server/         concurrent echo server and sample TCP client
  tests/          automated tests
  api/            reserved for the later FastAPI milestone
  security/       reserved for authentication/security milestones
  services/       reserved for application services
  uploads/        reserved for later file-transfer milestone
frontend/         reserved for the React + TypeScript milestone
uploads/          runtime upload location (ignored by Git)
documentation/    architecture and academic project notes
```

## Configuration

Copy `.env.example` to `.env` and set `NETCONNECT_TCP_HOST`, `NETCONNECT_TCP_PORT`, `NETCONNECT_DB_URL`, or `NETCONNECT_MAX_FRAME_BYTES`. The server and database modules read environment variables; `.env` loading is intentionally left to the shell for this initial milestone, so install/configuration commands should export values or use the shell's environment-file support.

## Roadmap

Milestone 1 is the current scope. Authentication, API/WebSocket bridge, rooms, private/group messaging, TCP file transfer, React UI/admin dashboard, monitoring views, TLS, and complete academic documentation remain future milestones. Features are not claimed complete until implemented and tested.
