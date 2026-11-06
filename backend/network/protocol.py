"""Length-prefixed JSON framing for the NetConnect TCP protocol.

TCP provides an ordered byte stream, not application message boundaries. Each
frame therefore starts with a 4-byte unsigned big-endian body length.
"""
import json
import socket
import struct
from typing import Any

HEADER_SIZE = 4
DEFAULT_MAX_FRAME_BYTES = 1024 * 1024


class ProtocolError(ValueError):
    """Raised when a peer sends an invalid or oversized frame."""


def recv_exactly(sock: socket.socket, count: int) -> bytes:
    """Read exactly count bytes, tolerating arbitrarily partial TCP reads."""
    chunks = bytearray()
    while len(chunks) < count:
        chunk = sock.recv(count - len(chunks))
        if not chunk:
            if not chunks:
                raise EOFError("peer closed the connection")
            raise ProtocolError("connection closed in the middle of a frame")
        chunks.extend(chunk)
    return bytes(chunks)


def encode_frame(message: dict[str, Any], max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES) -> bytes:
    if not isinstance(message, dict):
        raise ProtocolError("a frame must contain a JSON object")
    try:
        body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ProtocolError("message is not JSON serializable") from exc
    if not body or len(body) > max_frame_bytes:
        raise ProtocolError("frame size is outside the permitted range")
    return struct.pack("!I", len(body)) + body


def send_frame(sock: socket.socket, message: dict[str, Any], max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES) -> int:
    """Send a complete frame even if the socket performs a partial write."""
    frame = encode_frame(message, max_frame_bytes)
    sock.sendall(frame)
    return len(frame)


def recv_frame(sock: socket.socket, max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES) -> dict[str, Any]:
    header = recv_exactly(sock, HEADER_SIZE)
    (length,) = struct.unpack("!I", header)
    if length == 0 or length > max_frame_bytes:
        raise ProtocolError("frame size is outside the permitted range")
    body = recv_exactly(sock, length)
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError("frame body must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ProtocolError("frame body must be a JSON object")
    return value
