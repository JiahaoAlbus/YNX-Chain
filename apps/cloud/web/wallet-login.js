// Provider identity is used for explicit selection, never private authorization.
export function selectCloudWallet(entries, kind) {
  return entries.find(({info, provider}) => {
    if (!provider || typeof provider.request !== 'function') return false;
    const ynx = info?.rdns === 'com.ynx.wallet' || provider.isYNXWallet === true;
    const metamask = info?.rdns === 'io.metamask' || provider.isMetaMask === true;
    return kind === 'metamask' ? metamask && !ynx : kind === 'ynx' && ynx && !metamask;
  });
}

export function createCloudLogin({discover, createConnection, addChain, connected, message, busy}) {
  let generation = 0;
  let pending = false;
  return {
    cancel() { generation += 1; message('cancelled'); },
    async start(kind) {
      if (pending) return;
      pending = true;
      const attempt = ++generation;
      const current = () => attempt === generation;
      busy(true);
      message('waiting');
      try {
        const selected = selectCloudWallet(await discover(), kind);
        if (!current()) return;
        if (!selected) { message(kind === 'metamask' ? 'missingMetaMask' : 'missingYNX', true); return; }
        const connection = createConnection(selected.provider);
        const result = await connection.connect();
        if (!current()) return;
        await connection.ensureYNXTestnet({addChain});
        if (!current()) return;
        connected(connection, result, kind);
        message('connected');
      } catch (error) {
        if (!current()) return;
        const key = ['4001', 'WALLET_USER_REJECTED'].includes(String(error?.code)) ? 'rejected'
          : ['4200', 'WALLET_UNSUPPORTED_METHOD'].includes(String(error?.code)) ? 'unsupported' : 'failed';
        message(key, true);
      } finally {
        pending = false;
        busy(false);
      }
    },
  };
}
