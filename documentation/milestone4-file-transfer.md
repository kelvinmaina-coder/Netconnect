# Milestone 4 — TCP File Transfer

This milestone adds an independent Python `socket` + `threading` file-transfer service. File bytes use TCP directly; FastAPI exposes only the authenticated file metadata, transfer history, and service connection settings.

## Start services

```bash
python -m backend.database.init_db
python -m backend.server.echo_server
# In a separate terminal:
python -m backend.server.file_transfer_server
# In another terminal:
uvicorn backend.api.app:app --reload
```

The file service defaults to `127.0.0.1:9100`, stores data under `uploads/files`, and limits each upload to 10 MiB. Configure with `NETCONNECT_FILE_TCP_HOST`, `NETCONNECT_FILE_TCP_PORT`, `NETCONNECT_FILE_PUBLIC_HOST`, `NETCONNECT_UPLOAD_DIR`, and `NETCONNECT_MAX_FILE_BYTES`. For a LAN lab, bind to a private LAN interface or `0.0.0.0`, permit the chosen port in the lab firewall, and set `NETCONNECT_FILE_PUBLIC_HOST` to the server's reachable LAN address. Do not expose this service to an untrusted network: TLS is not implemented yet, so bearer tokens and file bytes are not encrypted in transit.

## Wire protocol

Each connection begins with a length-prefixed JSON control frame (4-byte unsigned big-endian body length, UTF-8 JSON object). Upload: client sends `{type: upload, token, filename, size_bytes}`, server authenticates and replies `upload_ready`, then client sends exactly `size_bytes` raw bytes; server replies `upload_complete` with generated file ID and SHA-256. Download: client sends `{type: download, token, file_id}`, server checks ownership and replies `download_ready` with size and digest, sends exactly that many raw bytes, then sends a `download_complete` control frame. A receiver must read exactly the announced byte count before decoding the next control frame; TCP does not preserve application write boundaries.

## Security and integrity

- API tokens are checked against persisted, unexpired sessions, and suspended accounts are rejected.
- Upload names are reduced to a basename; persisted storage uses a random generated name, never a user-supplied path.
- Files are streamed in bounded chunks into a temporary file, hashed during receipt, flushed, and atomically renamed after the complete payload arrives.
- Upload size is checked before accepting bytes; incomplete uploads are removed.
- Download lookup is scoped to the authenticated owner. Metadata and transfer history are likewise user-scoped.
- The SHA-256 digest is returned for integrity validation. It does not encrypt data or establish trust against an active network attacker.
- Files are private application data and are not exposed through a static web directory.

## Client

Obtain a bearer token from `POST /api/v1/auth/login`, then run:

```bash
NETCONNECT_TOKEN='<token>' python -m backend.server.file_transfer_client --host 127.0.0.1 upload ./notes.pdf
NETCONNECT_TOKEN='<token>' python -m backend.server.file_transfer_client --host 127.0.0.1 download 1 ./downloads/notes.pdf
```

Authenticated API endpoints:

- `GET /api/v1/files/tcp-info`
- `GET /api/v1/files`
- `GET /api/v1/files/transfers`

The initial implementation deliberately keeps the file transfer service separate from browser WebSockets and FastAPI, satisfying the TCP requirement. A React upload-progress UI and browser-to-TCP bridge remain later work.

## Testing

Run `pytest -q backend/tests/test_file_transfer.py`. The tests cover real loopback TCP upload/download, path-name sanitization, storage integrity, and transfer history. Test results are not asserted here; run them in the target environment.
