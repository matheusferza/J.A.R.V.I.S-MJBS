"""FastAPI backend for M.J.B.S AI; designed for future AI and automation providers."""
import asyncio
import datetime as dt
from contextlib import suppress
import os

import uvicorn
from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from ai import AIManager
from ai.elevenlabs_provider import ElevenLabsProvider
from config import load_project_env
from system.monitor import collect_metrics

load_project_env()
app = FastAPI(title="M.J.B.S AI Backend")

# Local Llama is the default; Gemini and GPT are automatic cloud fallbacks when configured.
ai_manager = AIManager()

# ElevenLabs é opcional: só instanciamos se a chave estiver presente no .env,
# para não derrubar o backend inteiro quando a voz ainda não foi configurada.
elevenlabs_provider = ElevenLabsProvider() if os.getenv("ELEVENLABS_API_KEY") else None


class TTSRequest(BaseModel):
    text: str


async def generate_reply(text: str) -> str:
    """Small deterministic command layer, intentionally replaceable by an LLM adapter."""
    answer = await ai_manager.reply(text)
    if answer:
        return answer
    lower = text.lower()
    if any(word in lower for word in ("hora", "time")):
        return f"Agora são {dt.datetime.now():%H:%M}."
    if "status" in lower or "sistema" in lower:
        return "Diagnóstico concluído. Os módulos monitorados estão em estado nominal."
    if "olá" in lower or "ola" in lower:
        return "Olá. Estou online e pronto para receber instruções."
    return f"Comando recebido: {text}. A camada de IA está preparada para integração."


async def metrics_loop(websocket: WebSocket) -> None:
    """Push periodic monitoring data through the shared WebSocket channel."""
    while True:
        await websocket.send_json({"type": "metrics", "data": collect_metrics()})
        await asyncio.sleep(1.2)


@app.get('/health')
async def health() -> dict[str, str]:
    return {"status": "online", "service": "M.J.B.S AI"}


@app.post("/tts")
async def tts(request: TTSRequest):
    """Synthesize speech via ElevenLabs and return raw audio bytes (audio/mpeg).

    A key protegida fica só aqui no backend; o cliente Electron nunca vê a
    ELEVENLABS_API_KEY. O front-end chama este endpoint com o texto da
    resposta e toca o áudio recebido via HTMLAudioElement (Fase 2).
    """
    if elevenlabs_provider is None:
        return JSONResponse(
            status_code=503,
            content={"error": "ELEVENLABS_API_KEY não configurada no .env."},
        )
    if not request.text.strip():
        return JSONResponse(status_code=400, content={"error": "Campo 'text' vazio."})

    try:
        audio_bytes = await elevenlabs_provider.synthesize(request.text)
    except Exception as exc:  # SDK pode lançar erros de rede, quota, voice_id inválido, etc.
        return JSONResponse(
            status_code=502,
            content={"error": f"Falha ao gerar áudio via ElevenLabs: {exc}"},
        )

    return Response(content=audio_bytes, media_type="audio/mpeg")


@app.websocket('/ws')
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    task = asyncio.create_task(metrics_loop(websocket))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "command":
                reply = await generate_reply(message.get("text", ""))
                await websocket.send_json({"type": "reply", "text": reply})
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError): await task

if __name__ == '__main__':
    uvicorn.run('app:app', host='127.0.0.1', port=8000, reload=False)
