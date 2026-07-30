const { contextBridge } = require('electron');

/**
 * Preload script que executa em contexto seguro.
 * Expõe apenas APIs essenciais ao renderer de forma isolada.
 */
contextBridge.exposeInMainWorld('mjbs', {
  version: '1.0.0',
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development',
});
