# M.J.B.S AI

M.J.B.S (Minimal Jarvis Bot Shell) — assistente desktop estilo HUD de ficção científica.
Cliente: Electron (renderer com Three.js / @pixiv/three-vrm para avatar VRM).
Backend: FastAPI (websocket + REST para utilidades como TTS).

Este repositório contém o frontend Electron e o backend Python que rodam localmente para prover uma experiência responsiva e privada.

---

## Funcionalidades principais

- Avatar 3D (VRM) renderizado na HUD com overlay "plexus" (linhas + nós) e efeitos holográficos.
- Comunicação em tempo real via WebSocket entre frontend (Electron) e backend (FastAPI).
- Integração com provedores de IA (Gemini por padrão) para conversação; arquitetura de provedores modular em `python/ai/`.
- Endpoint REST TTS (/tts) para gerar áudio (integração opcional com ElevenLabs mantendo a API key no backend).

---

## Pré-requisitos

- Node.js (v18+ recomendado)
- Python 3.10+ e virtualenv (ou equivalente)
- Git

Observação: o projeto foi desenvolvido em Windows; alguns caminhos e scripts usam sintaxe Windows.

---

## Configuração rápida (desenvolvimento)

1) Backend (Python)

```powershell
cd python
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # PowerShell
pip install -r requirements.txt
python app.py
```

O backend inicia por padrão em http://127.0.0.1:8000 e expõe o WebSocket em ws://127.0.0.1:8000/ws.

2) Frontend (Electron)

Em outro terminal (na raiz do projeto):

```powershell
npm install
npm start
```

---

## Variáveis de ambiente (.env)

Coloque um arquivo `.env` na raiz (ou ajuste `.env.example`). Principais variáveis:

- GEMINI_API_KEY=seu_token_gemini_aqui
- GEMINI_MODEL=gemini-3.5-flash
- ELEVENLABS_API_KEY=seu_token_eleventlabs_aqui   # opcional; se ausente, /tts ficará desabilitado
- MJBS_OFFLINE=E:\MJBS_OFFLINE  # caminho opcional para IA local (modo offline)

Importante: mantenha chaves secretas apenas no backend e nunca as exponha no cliente.

---

## Endpoint TTS (ElevenLabs)

O backend expõe um endpoint REST POST /tts que aceita JSON { "text": "..." } e responde com áudio (mp3). Exemplo de teste:

```powershell
curl -X POST http://127.0.0.1:8000/tts -H "Content-Type: application/json" -d "{\"text\":\"Olá, senhor.\"}" --output teste.mp3
```

Se `ELEVENLABS_API_KEY` não estiver presente, o endpoint falhará com 503/erro — a chave deve permanecer somente no `.env` do backend.

O provedor ElevenLabs fica em `python/ai/elevenlabs_provider.py` seguindo o mesmo padrão dos provedores existentes.

---

## Estrutura do repositório (resumo)

- electron/
  - main.js, renderer.js, preload.js
  - modules/ (OrbRenderer.js, VoiceManager.js, HUDManager.js, etc.)
  - assets/ (modelos .vrm/.glb, texturas)
- python/
  - app.py (FastAPI)
  - ai/ (provedores: gemini_provider.py, elevenlabs_provider.py, router.py)
  - requirements.txt
- README.md (este arquivo)

---

## Desenvolvimento e debug

- Para ajustar parâmetros visuais (densidade do icosahedron, opacities, sprite sizes, etc.) edite `electron/modules/OrbRenderer.js`.
- Logs de depuração sobre projeção/overlay aparecem no console do renderer; abra DevTools manualmente enquanto desenvolve (não é necessário que fique aberto em produção).
- Se o overlay parecer “flutuante” em VRMs skinned, a função de bake CPU tenta aplicar `applyBoneTransform` ou `boneTransform`. Caso esse método falhe em algum VRM, é necessário implementar o bake de skinning manual (skinIndex/skinWeight + boneMatrices).

---

## Testes rápidos

- Teste de TTS com curl (veja seção acima).
- Carregue `electron/assets/jarvis-face.vrm` no app e observe logs do OrbRenderer para confirmar criação de overlay (contagem de segmentos e sprites).

---

## Problemas conhecidos

- Alguns materiais MToon/custom shader não recebem a injeção de hologram shader para evitar quebrar a compilação — nesses casos o dim do material e overlays são usados para obter o efeito desejado.
- Se houver diferenças significativas de versão do three.js / three-vrm, funções como `mesh.applyBoneTransform` podem não existir; pode ser necessário adaptar para a versão usada.

---

## Contribuição

Pull requests são bem-vindos. Se for um PR grande, abra uma issue descrevendo o plano antes de implementar.

Ao submeter PRs, evite incluir chaves secrets, modelos pesados ou arquivos binários desnecessários; use releases/asset uploads para modelos grandes.

---

## Licença

Adicione aqui a licença desejada (por exemplo MIT). Atualmente, este repositório não possui um arquivo LICENSE — adicione se quiser explicitar termos.

---

Se quiser, posso também:
- adicionar um arquivo LICENSE (MIT) e commitar;
- remover arquivos temporários (ex.: teste.mp3) que talvez não devam estar no repositório;
- normalizar finais de linha via .gitattributes.
