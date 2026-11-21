'use strict';

/**
 * Application menu template. Reload and DevTools exist only in development so a
 * packaged till cannot be reloaded mid-sale by accident or poked at by users.
 */
function buildMenuTemplate({ isDev, isMac, appName, onOpenSetup, onCheckUpdates, onOpenLogs, onAbout }) {
  const view = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];
  if (isDev) view.unshift({ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' });

  return [
    ...(isMac ? [{ label: appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Server settings…', click: onOpenSetup },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: view },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates', click: onCheckUpdates },
        { label: 'Open log folder', click: onOpenLogs },
        { type: 'separator' },
        { label: `About ${appName}`, click: onAbout },
      ],
    },
  ];
}

module.exports = { buildMenuTemplate };
