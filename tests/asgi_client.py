"""Tiny stdlib-only stand-in for fastapi.testclient.TestClient.

Starlette's TestClient needs the httpx2 (or httpx) package, which is not in requirements.txt.
This helper drives the ASGI app directly and offers the same calls the tests use
(client.get / client.post / `with client:` for startup and shutdown). To switch to the real thing
later: install httpx, then in tests/test_mobile_api.py use
`from fastapi.testclient import TestClient as ASGIClient`.
"""
import asyncio
import json as jsonlib
from urllib.parse import urlencode


class Response:
    def __init__(self, status_code, headers, content):
        self.status_code = status_code
        self.headers = headers
        self.content = content

    @property
    def text(self):
        return self.content.decode("utf-8")

    def json(self):
        return jsonlib.loads(self.content)


class ASGIClient:
    def __init__(self, app):
        self.app = app
        self._loop = None

    # -- requests -----------------------------------------------------------------
    def get(self, path, params=None):
        return self._run(self._call("GET", path, params, None))

    def post(self, path, json=None):
        body = None if json is None else jsonlib.dumps(json).encode()
        return self._run(self._call("POST", path, None, body))

    def _run(self, coro):
        if self._loop is not None:
            return self._loop.run_until_complete(coro)
        return asyncio.run(coro)

    async def _call(self, method, path, params, body):
        body = body or b""
        headers = [(b"host", b"testserver"), (b"content-length", str(len(body)).encode())]
        if body:
            headers.append((b"content-type", b"application/json"))
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
                 "scheme": "http", "path": path, "raw_path": path.encode(),
                 "query_string": urlencode(params or {}).encode(), "headers": headers,
                 "client": ("testclient", 50000), "server": ("testserver", 80), "state": {}}
        sent = False
        messages = []

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.sleep(3600)  # stay pending like a real connection until cancelled

        async def send(message):
            messages.append(message)

        await self.app(scope, receive, send)
        start = next(m for m in messages if m["type"] == "http.response.start")
        data = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return Response(start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, data)

    # -- lifespan (startup / shutdown), used as `with client:` ------------------------
    def __enter__(self):
        self._loop = asyncio.new_event_loop()
        self._loop.run_until_complete(self._startup())
        return self

    def __exit__(self, *exc):
        try:
            self._loop.run_until_complete(self._shutdown())
        finally:
            self._loop.close()
            self._loop = None

    async def _startup(self):
        self._to_app, self._from_app = asyncio.Queue(), asyncio.Queue()
        self._task = asyncio.ensure_future(self.app(
            {"type": "lifespan", "asgi": {"version": "3.0"}, "state": {}}, self._to_app.get, self._from_app.put))
        await self._to_app.put({"type": "lifespan.startup"})
        message = await self._from_app.get()
        if message["type"] != "lifespan.startup.complete":
            raise RuntimeError(f"startup failed: {message}")

    async def _shutdown(self):
        await self._to_app.put({"type": "lifespan.shutdown"})
        await self._from_app.get()
        await self._task
