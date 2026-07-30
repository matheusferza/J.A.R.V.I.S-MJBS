"""Optional local provider served by llama.cpp from the external SSD."""

import asyncio
import json
import os
from pathlib import Path
from time import monotonic
from urllib.error import URLError
from urllib.request import Request, urlopen


class OfflineProvider:
    """Calls a warm local llama.cpp server without adding Python dependencies."""

    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint.rstrip("/")
        self._next_health_check = 0.0
        self._is_available = False

    @classmethod
    def from_environment(cls) -> "OfflineProvider | None":
        root = Path(os.getenv("MJBS_OFFLINE_ROOT", r"E:\MJBS_OFFLINE"))
        executable = root / "engine" / "llama-server.exe"
        if not executable.exists():
            return None
        return cls(os.getenv("MJBS_OFFLINE_ENDPOINT", "http://127.0.0.1:8081"))

    async def is_available(self) -> bool:
        now = monotonic()
        if now < self._next_health_check:
            return self._is_available

        def check() -> bool:
            try:
                with urlopen(f"{self.endpoint}/health", timeout=0.35) as response:
                    return response.status == 200
            except (OSError, URLError):
                return False

        self._is_available = await asyncio.to_thread(check)
        self._next_health_check = now + (30 if self._is_available else 5)
        return self._is_available

    async def reply(self, prompt: str, instructions: str) -> str | None:
        if not await self.is_available():
            return None

        payload = json.dumps(
            {
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.5,
                "max_tokens": 384,
            },
        ).encode("utf-8")

        def request_reply() -> str | None:
            request = Request(
                f"{self.endpoint}/v1/chat/completions",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urlopen(request, timeout=45) as response:
                    data = json.load(response)
                return data["choices"][0]["message"]["content"].strip()
            except (KeyError, OSError, URLError, ValueError):
                return None

        return await asyncio.to_thread(request_reply)
