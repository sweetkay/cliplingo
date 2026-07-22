import { defaultSettings, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...defaultSettings, ...(data.settings || {}) };
}

export async function saveSettings(settings: Settings) {
  await chrome.storage.local.set({ settings });
}
