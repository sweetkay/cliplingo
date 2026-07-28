import { defaultSettings, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  const stored = (data.settings || {}) as Omit<Partial<Settings>, 'translationMode'> & {
    translationMode?: Settings['translationMode'] | 'chrome-fallback-minimax';
  };
  const settings = { ...defaultSettings, ...stored } as Settings;
  if (stored.translationMode === 'chrome-fallback-minimax') settings.translationMode = 'site-chrome';
  return settings;
}

export async function saveSettings(settings: Settings) {
  await chrome.storage.local.set({ settings });
}
