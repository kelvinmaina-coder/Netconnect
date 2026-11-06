"""Interactive client for manually exercising the length-prefixed TCP echo server."""
import argparse
import socket

from backend.network.protocol import recv_frame, send_frame


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    args = parser.parse_args()

    with socket.create_connection((args.host, args.port)) as sock:
        print("Server:", recv_frame(sock))
        print("Type a message; enter 'quit' to disconnect.")
        while True:
            line = input("> ")
            if line.strip().lower() == "quit":
                break
            send_frame(sock, {"type": "message", "text": line})
            print("Echo:", recv_frame(sock))


if __name__ == "__main__":
    main()
