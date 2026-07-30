"""AI providers used by M.J.B.S."""

class AIProvider:
    """Interface base deliberately free of vendor-specific dependencies."""

    async def reply(self, prompt: str) -> str:
        raise NotImplementedError("Configure an AI provider to generate replies.")

from .router import AIManager

__all__ = ["AIProvider", "AIManager"]
