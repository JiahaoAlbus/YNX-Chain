import {readFileSync} from 'node:fs';
export const registry=JSON.parse(readFileSync(new URL('./product-session-registry.json',import.meta.url),'utf8'));
