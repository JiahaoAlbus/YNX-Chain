import type {CentralBrowserClient} from './central-browser-session-contract.js';
export const CENTRAL_BROWSER_ISSUER: "https://wallet-auth.ynxweb4.com";
export function createCentralBrowserSessionRegistry(productRegistry: unknown, options?: {ecosystem?: boolean}): readonly CentralBrowserClient[];
export function centralBrowserClient(registry: readonly CentralBrowserClient[], input: {clientId: string; origin: string; redirectUri: string}): CentralBrowserClient;
