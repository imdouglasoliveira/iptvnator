import { ipcRenderer } from 'electron';

export const preloadPlatform = {
    platform: process.platform,
    isLowEndHardware: () => ipcRenderer.sendSync('LOW_END_HARDWARE') === true,
};
