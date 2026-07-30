"""ElevenLabs text-to-speech adapter, authenticated through ELEVENLABS_API_KEY."""

import asyncio
import os

from elevenlabs.client import ElevenLabs


class ElevenLabsProvider:
    """Wraps the official ElevenLabs SDK to synthesize speech as raw audio bytes.

    Kept deliberately separate from AIManager (router.py): text generation and
    speech synthesis are independent concerns, so a failure or change in one
    never touches the other.
    """

    def __init__(self) -> None:
        # "George" e eleven_v3 são os defaults recomendados no quickstart oficial;
        # troque via .env sem precisar mexer no código.
        self.voice_id = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
        self.model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_v3")
        self.output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128")
        self.client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])

    async def synthesize(self, text: str) -> bytes:
        """Run the synchronous SDK call outside the FastAPI event loop.

        convert() returns a generator of audio chunks; joining it here keeps
        the rest of the app working with a single bytes object for now.
        Streaming chunk-by-chunk to the client is a natural Fase 2 upgrade.
        """

        def _convert() -> bytes:
            audio_stream = self.client.text_to_speech.convert(
                text=text,
                voice_id=self.voice_id,
                model_id=self.model_id,
                output_format=self.output_format,
            )
            return b"".join(audio_stream)

        return await asyncio.to_thread(_convert)
