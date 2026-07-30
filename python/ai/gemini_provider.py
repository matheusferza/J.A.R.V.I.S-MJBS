"""Google Gemini adapter, authenticated through GEMINI_API_KEY in the local .env."""

import asyncio
import os

from google import genai
from google.genai import types


class GeminiProvider:
    """Uses Google's current GenAI Python SDK while keeping the key server-side."""

    def __init__(self) -> None:
        self.model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        # Avoid the SDK's long default retry cycle when Gemini is under high demand.
        self.client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options=types.HttpOptions(
                timeout=15_000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

    async def reply(self, prompt: str, instructions: str) -> str:
        """Run the synchronous SDK outside the FastAPI event loop."""
        message = f"{instructions}\n\nUsuário: {prompt}"
        response = await asyncio.to_thread(
            self.client.models.generate_content, model=self.model, contents=message
        )
        answer = (response.text or "").strip()
        if not answer:
            raise RuntimeError("Gemini returned an empty response")
        return answer
