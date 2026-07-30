import { ConversationManager } from './modules/ConversationManager.js';
import { HUDManager } from './modules/HUDManager.js';
import { ParticleEngine } from './modules/ParticleEngine.js';
import { SocketManager } from './modules/SocketManager.js';
import { SystemMonitor } from './modules/SystemMonitor.js';
import { VoiceManager } from './modules/VoiceManager.js';

// --- Seletores do DOM ---
const conversationContainer = document.querySelector('#conversation');
const systemWidgetsContainer = document.querySelector('#system-widgets');
const micButton = document.querySelector('#mic-button');
const particlesCanvas = document.querySelector('#particles');
const threeCanvas = document.querySelector('#three-canvas');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');

// --- Variáveis de Instância Globais ---
let hud = null;
let conversation = null;
let socket = null;
let monitor = null;
let voice = null;
let orbRenderer = null;
let animationManager = null;
let particleEngine = null;

// --- Função para Envio de Comandos ---
function sendCommand(text) {
  if (!text || !text.trim()) return;

  if (conversation) {
    conversation.add('USER', text);
  }

  if (socket) {
    socket.send({ type: 'command', text });
  }

  commandInput.value = '';
  document.body.classList.add('jarvis-thinking');

  if (hud) {
    hud.setOrbStatus('PROCESSING INPUT');
  }
}

// --- Função para Controlar Estado de Fala (Speaking State) ---
function setSpeakingState(isSpeaking) {
  // Notifica o renderizador 3D para alterar opacidade/animação durante a fala
  if (orbRenderer && typeof orbRenderer.setSpeaking === 'function') {
    orbRenderer.setSpeaking(isSpeaking);
  }

  if (isSpeaking) {
    document.body.classList.add('jarvis-speaking');
  } else {
    document.body.classList.remove('jarvis-speaking');
  }
}

// --- Inicialização Assíncrona e Isolada dos Módulos ---
const initModules = async () => {
  try {
    // 1. HUD Manager (Crítico)
    try {
      hud = new HUDManager();
    } catch (err) {
      console.error('❌ Erro crítico ao inicializar HUDManager:', err);
    }

    // 2. Conversation Manager
    try {
      conversation = new ConversationManager(conversationContainer);
    } catch (err) {
      console.error('❌ Erro ao inicializar ConversationManager:', err);
    }

    // 3. Socket Manager & Eventos
    try {
      socket = new SocketManager('ws://127.0.0.1:8000/ws');

      socket.on('open', () => {
        if (hud) hud.connection(true);
      });

      socket.on('close', () => {
        if (hud) hud.connection(false);
      });

      socket.on('message', (data) => {
        try {
          if (data.type === 'metrics' && monitor) {
            monitor.update(data.data);
          }

          if (data.type === 'reply') {
            document.body.classList.remove('jarvis-thinking');

            if (conversation) {
              conversation.add('JARVIS', data.text, true);
            }

            setSpeakingState(true);

            if (voice) {
              voice.speak(data.text);
            }

            if (hud) {
              hud.setOrbStatus('AWAITING COMMAND');
            }
          }
        } catch (err) {
          console.error('Erro ao processar mensagem do socket:', err);
        }
      });

    } catch (err) {
      console.error('❌ Erro ao inicializar SocketManager:', err);
    }

    // 4. System Monitor
    try {
      monitor = new SystemMonitor(systemWidgetsContainer);
    } catch (err) {
      console.error('❌ Erro ao inicializar SystemMonitor:', err);
    }

    // 5. Voice Manager
    try {
      voice = new VoiceManager(micButton, (text) => sendCommand(text));

      // Associa o evento de término da fala
      if (voice) {
        const originalOnEnd = voice.onEnd;
        voice.onEnd = () => {
          setSpeakingState(false);
          if (typeof originalOnEnd === 'function') {
            try {
              originalOnEnd();
            } catch (err) {
              console.error('Erro em VoiceManager.onEnd:', err);
            }
          }
        };
      }
    } catch (err) {
      console.error('❌ Erro ao inicializar VoiceManager:', err);
    }

    // 6. Animation Manager
    try {
      const { AnimationManager } = await import('./modules/AnimationManager.js');
      animationManager = new AnimationManager();
    } catch (err) {
      console.error('❌ Erro ao inicializar AnimationManager:', err);
    }

    // 7. Particle Engine
    try {
      particleEngine = new ParticleEngine(particlesCanvas);
    } catch (err) {
      console.error('❌ Erro ao inicializar ParticleEngine:', err);
    }

    // 8. OrbRenderer (Modelo 3D Holográfico)
    try {
      const { OrbRenderer } = await import('./modules/OrbRenderer.js');
      orbRenderer = new OrbRenderer(threeCanvas);

      const checkModelLoaded = setInterval(() => {
        if (orbRenderer && typeof orbRenderer.isReady === 'function' && orbRenderer.isReady()) {
          clearInterval(checkModelLoaded);
        }
      }, 500);
    } catch (err) {
      console.error('❌ Erro ao inicializar OrbRenderer (3D):', err);
    }
  } catch (err) {
    console.error('❌ Erro geral na inicialização dos módulos:', err);
  }
};

// --- Event Listeners DOM ---
if (commandForm) {
  commandForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (commandInput) {
      sendCommand(commandInput.value);
    }
  });
}

// --- Execução da Inicialização do HUD ---
initModules()
  .then(() => {
    // Mensagem Inicial no Chat
    if (conversation) {
      conversation.add(
        'JARVIS',
        'M.J.B.S AI inicializado. Todos os subsistemas estão operacionais.',
        true,
      );
    }

    // Inicia o Relógio do HUD
    if (hud && typeof hud.startClock === 'function') {
      hud.startClock();
    }
  })
  .catch((err) => {
    console.error('❌ Falha na rotina final de boot:', err);
    if (hud && typeof hud.startClock === 'function') {
      hud.startClock();
    }
  });
