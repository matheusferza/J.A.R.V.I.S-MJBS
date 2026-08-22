const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Registrar o esquema 'app' como standard e secure antes de carregar qualquer recurso
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/**
 * Cria a janela isolada do M.J.B.S desktop.
 * Configurado para máxima segurança com contextIsolation e sem nodeIntegration.
 */
function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 650,
    backgroundColor: '#02070c',
    icon: path.join(__dirname, 'assets', 'JARVIS-LOGO.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      // Permite ES modules no renderer
      sandbox: false,
    },
  });

  // Carrega usando o protocolo customizado para resolver problemas de CORS e caminhos locais
  window.loadURL('app://electron/index.html');

  // Abre DevTools em desenvolvimento (descomentar se necessário)
  // window.webContents.openDevTools();

  // Inicia em modo imersivo; Escape restaura a janela normal do desktop
  window.once('ready-to-show', () => {
    window.setFullScreen(true);
  });

  // Controla o Escape para sair do fullscreen
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && window.isFullScreen()) {
      event.preventDefault();
      window.setFullScreen(false);
      window.center();
    }
  });

  // Log de erros de renderização
  window.webContents.on('crashed', () => {
    console.error('❌ Renderer process crashed!');
    app.quit();
  });

  // Forward renderer console messages to the main process output for debugging
  window.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelNames = ['LOG', 'WARNING', 'ERROR', 'INFO', 'DEBUG'];
    const levelName = levelNames[level] || `LVL_${level}`;
    console.log(`[renderer console ${levelName}] ${message} (${sourceId}:${line})`);
  });

  window.webContents.on('unresponsive', () => {
    console.warn('⚠ Renderer process became unresponsive');
  });
}

// Ciclo de vida da aplicação
app.whenReady().then(() => {
  const PROJECT_ROOT = path.join(__dirname, '..');

  // Registrar o handler para resolver requisições app:// mapeando-as para a pasta raiz
  protocol.handle('app', async (request) => {
    try {
      // Remove o prefixo 'app://' para obter o caminho relativo completo (ex: electron/index.html)
      let rawPath = request.url.replace(/^app:\/\//, '');

      // Se a resolução de URL do navegador mantiver o host 'electron' ao acessar node_modules, retraduz para a raiz
      if (rawPath.startsWith('electron/node_modules/')) {
        rawPath = rawPath.replace(/^electron\/node_modules\//, 'node_modules/');
      }

      const relativePath = decodeURIComponent(rawPath);
      const absolutePath = path.join(PROJECT_ROOT, relativePath);
      const fileUrl = pathToFileURL(absolutePath).toString();
      const response = await net.fetch(fileUrl);

      const ext = path.extname(absolutePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.bin': 'application/octet-stream',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.wasm': 'application/wasm',
      };

      if (mimeTypes[ext]) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Content-Type', mimeTypes[ext]);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      return response;
    } catch (error) {
      console.error('❌ Erro no handler do protocolo app:', error);
      return new Response('Not Found', { status: 404 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Tratamento de exceções não capturadas
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
