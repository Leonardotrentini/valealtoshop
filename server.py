"""Serve a landing page e encaminha eventos para a Meta Conversions API."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env(ROOT / ".env")

PIXEL_ID = os.environ.get("META_PIXEL_ID", "2149605386435935")
ACCESS_TOKEN = os.environ.get("META_ACCESS_TOKEN", "")
API_VERSION = os.environ.get("META_API_VERSION", "v21.0")
PORT = int(os.environ.get("PORT", "5500"))
ALLOWED_EVENTS = {"PageView", "Lead", "Contact", "ViewContent", "InitiateCheckout", "Purchase"}


def send_capi(event: dict, client_ip: str, user_agent: str) -> dict:
    if not ACCESS_TOKEN:
        raise RuntimeError("META_ACCESS_TOKEN não configurado no .env")

    event_name = event.get("event_name")
    if event_name not in ALLOWED_EVENTS:
        raise ValueError(f"event_name inválido: {event_name}")

    event_id = event.get("event_id")
    if not event_id or not isinstance(event_id, str):
        raise ValueError("event_id é obrigatório")

    user_data: dict = {
        "client_ip_address": client_ip,
        "client_user_agent": user_agent,
    }
    for key in ("fbp", "fbc"):
        value = event.get(key)
        if isinstance(value, str) and value:
            user_data[key] = value

    payload = {
        "data": [
            {
                "event_name": event_name,
                "event_time": int(time.time()),
                "event_id": event_id,
                "event_source_url": event.get("event_source_url") or "",
                "action_source": "website",
                "user_data": user_data,
            }
        ],
        "access_token": ACCESS_TOKEN,
    }

    url = f"https://graph.facebook.com/{API_VERSION}/{PIXEL_ID}/events"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        if self.path != "/api/capi":
            self.send_error(404)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/api/capi":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "JSON inválido"})
            return

        forwarded = self.headers.get("X-Forwarded-For", "")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (self.client_address[0] or "")
        user_agent = self.headers.get("User-Agent", "")

        try:
            result = send_capi(body, client_ip, user_agent)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "meta": result}).encode("utf-8"))
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            self._json(exc.code, {"ok": False, "error": detail})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    if not ACCESS_TOKEN:
        raise SystemExit("Configure META_ACCESS_TOKEN no arquivo .env")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Vale Alto Shop em http://localhost:{PORT}/")
    print(f"CAPI ativo -> pixel {PIXEL_ID}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")


if __name__ == "__main__":
    main()
