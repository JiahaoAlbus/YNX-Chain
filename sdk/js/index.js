export async function getYNXStatus(baseUrl) {
  const res = await fetch(new URL('/status', baseUrl));
  if (!res.ok) throw new Error(`YNX status failed: ${res.status}`);
  return res.json();
}

export const ynxTestnet = {
  chainId: '0x1917',
  chainName: 'YNX Testnet',
  nativeCurrency: { name: 'YNXT', symbol: 'YNXT', decimals: 18 }
};

