const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const listen = (channel) => (cb) => {
  const handler = (_event, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('notch', {
  hover: send('notch:hover'),
  collapse: send('notch:collapse'),
  setPinned: invoke('notch:pin'),
  quit: send('app:quit'),

  getConfig: invoke('config:get'),
  saveSettings: invoke('settings:set'),
  pauseHotkey: invoke('hotkey:pause'),
  resumeHotkey: invoke('hotkey:resume'),

  google: {
    status: invoke('google:status'),
    login: invoke('google:login'),
    cancel: invoke('google:cancel'),
    logout: invoke('google:logout'),
    events: invoke('google:events'),
  },

  media: invoke('media:key'),
  mediaSessions: invoke('media:sessions'),
  mediaControl: invoke('media:session'),
  onMediaSessions: listen('media:sessions'),

  shortcuts: {
    list: invoke('shortcuts:list'),
    installed: invoke('shortcuts:installed'),
    icon: invoke('shortcuts:icon'),
    add: invoke('shortcuts:add'),
    update: invoke('shortcuts:update'),
    remove: invoke('shortcuts:remove'),
    open: invoke('shortcuts:open'),
    pickFile: invoke('shortcuts:pickFile'),
    onChanged: listen('shortcuts:changed'),
  },
  openSite: invoke('site:open'),
  systemInfo: invoke('sys:info'),

  onState: listen('notch:state'),
});
