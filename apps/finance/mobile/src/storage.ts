import * as SecureStore from 'expo-secure-store';
export type Settings={locale:string;aiLocale:string;theme:'system'|'light'|'dark'};
const SETTINGS='ynx.finance.settings.v1',CACHE='ynx.finance.offline.v1';
export const defaultSettings:Settings={locale:'system',aiLocale:'en',theme:'system'};
export async function loadSettings(){try{return {...defaultSettings,...JSON.parse((await SecureStore.getItemAsync(SETTINGS))||'{}')}}catch{return defaultSettings}}
export const saveSettings=(v:Settings)=>SecureStore.setItemAsync(SETTINGS,JSON.stringify(v));
export const loadCache=async()=>{try{return JSON.parse((await SecureStore.getItemAsync(CACHE))||'null')}catch{return null}};
export const saveCache=(v:unknown)=>SecureStore.setItemAsync(CACHE,JSON.stringify({savedAt:new Date().toISOString(),data:v}));
