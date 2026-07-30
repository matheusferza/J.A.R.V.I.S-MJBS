# M.J.B.S AI

Assistente desktop futurista inspirado em HUDs de ficção científica, usando Electron no cliente e FastAPI no serviço local.

## Executar

Em dois terminais na raiz do projeto:

```powershell
pip install -r python/requirements.txt
python python/app.py
```

```powershell
npm install
npm start
```

O backend envia telemetria via `ws://127.0.0.1:8000/ws`. O frontend envia comandos JSON e recebe respostas no formato `{ "type": "reply", "text": "..." }`.

## Provedores de IA

O M.J.B.S usa o Gemini através da chave `GEMINI_API_KEY`. Saudações, agradecimentos, despedidas, status, identidade e conversas curtas são respondidos localmente e instantaneamente.

Perguntas fora dessas intenções seguem para o Gemini.

Opcionalmente, ajuste a ordem no `.env`:

```env
GEMINI_MODEL=gemini-3.5-flash
```

Linhas de anotação no `.env` devem iniciar com `#`. O M.J.B.S ignora com segurança linhas que não sejam variáveis válidas, para manter a leitura da chave Gemini estável.

## Modo offline (SSD externo)

O SSD `MJBS_OFFLINE` usa o diretório `E:\MJBS_OFFLINE`. Quando `llama-server.exe`
e um arquivo `model.gguf` estiverem presentes nele, o modo `auto` usa a IA local
primeiro e mantém Gemini como fallback. O modo `local` evita qualquer uso de nuvem.

```powershell
E:\MJBS_OFFLINE\start-local-ai.cmd
```

O servidor permanece carregado em memória após iniciar, evitando que o modelo seja
reaberto a cada comando.

## Arquitetura

- `electron/modules`: HUD, animação, partículas, orb 3D, voz, conversa, monitor e WebSocket isolados.
- `python/app.py`: endpoint de saúde, telemetria com `psutil` e WebSocket FastAPI.
- A função `generate_reply` concentra as respostas locais e a integração com Gemini.
