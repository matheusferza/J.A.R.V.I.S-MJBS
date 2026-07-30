"""Provider routing: local replies, optional SSD model, then Gemini."""

import asyncio
import os

from ai.gemini_provider import GeminiProvider
from ai.local_responses import get_local_response
from ai.offline_provider import OfflineProvider


class AIManager:
    """Routes requests locally, through the optional SSD model, or Gemini."""

    instructions = (
        "Você é M.J.B.S AI, um assistente desktop futurista inspirado em JARVIS. "
        "Responda em português do Brasil, com clareza, elegância e objetividade. "
        "Não alegue executar ações no computador sem uma integração confirmada."
    )

    def __init__(self) -> None:
        mode = os.getenv("MJBS_AI_MODE", "auto").lower()
        self.mode = mode if mode in {"auto", "local", "cloud"} else "auto"
        self.offline = OfflineProvider.from_environment() if self.mode != "cloud" else None
        self.gemini = GeminiProvider() if os.getenv("GEMINI_API_KEY") else None

    async def reply(self, prompt: str) -> str | None:
        """Use instant local answers first, then delegate unfamiliar requests to Gemini."""
        local_answer = get_local_response(prompt)
        if local_answer:
            return local_answer
        if self.offline:
            answer = await self.offline.reply(prompt, self.instructions)
            if answer:
                return answer
        if self.mode == "local":
            return "A IA offline não está pronta. Conecte o SSD e inicie o servidor local."
        if self.gemini is None:
            return "A chave GEMINI_API_KEY não está configurada no arquivo .env."
        try:
            return await asyncio.wait_for(self.gemini.reply(prompt, self.instructions), timeout=30)
        except Exception:
            return "O Gemini está temporariamente indisponível. Tente novamente em alguns segundos."
