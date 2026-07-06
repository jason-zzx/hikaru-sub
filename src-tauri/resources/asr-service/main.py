"""ASR sidecar 入口。

启动方式（由 Tauri 作为子进程拉起，或本地手动运行）：

    python main.py --host 127.0.0.1 --port 0

`--port 0` 时自动选取空闲端口。服务就绪后会向 stdout 打印一行 JSON：

    {"event": "ready", "host": "127.0.0.1", "port": 53124}

Tauri 侧据此捕获实际端口并发起 HTTP 调用。
"""

from __future__ import annotations

import argparse
import json
import socket
import sys

import uvicorn

from diagnostics import debug_exception, debug_log
from server import create_app


def _bind_socket(host: str, port: int) -> socket.socket:
    """绑定监听 socket 并返回（port=0 时由系统分配空闲端口）。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen()
    sock.set_inheritable(True)
    return sock


def main() -> None:
    parser = argparse.ArgumentParser(description="Hikaru-Sub ASR sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="0 = 自动选择空闲端口")
    parser.add_argument("--log-level", default="warning")
    args = parser.parse_args()
    debug_log("main_start", host=args.host, port=args.port, argv=sys.argv)

    sock = _bind_socket(args.host, args.port)
    actual_port = sock.getsockname()[1]
    debug_log("socket_bound", host=args.host, port=actual_port)

    app = create_app()
    config = uvicorn.Config(app, log_level=args.log_level)
    server = uvicorn.Server(config)

    # 在真正进入事件循环前打印就绪信息，确保 socket 已可接受连接
    print(
        json.dumps({"event": "ready", "host": args.host, "port": actual_port}),
        flush=True,
    )
    debug_log("ready_printed", host=args.host, port=actual_port)

    try:
        server.run(sockets=[sock])
    except Exception as exc:
        debug_exception("server_run_error", exc)
        raise
    except KeyboardInterrupt:
        debug_log("keyboard_interrupt")
        pass
    finally:
        debug_log("main_shutdown")
        sock.close()
        sys.stdout.flush()


if __name__ == "__main__":
    main()
