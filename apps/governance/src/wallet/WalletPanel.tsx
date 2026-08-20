import React, { useState } from 'react';
import {
  connectStandardWallet,
  StandardConnectionResult,
  WalletChoice,
  YNX_WALLET_DOWNLOAD_URL,
} from './connection';

type Status =
  | { kind: 'guest' }
  | { kind: 'connecting'; choice: WalletChoice }
  | { kind: 'connected'; connection: StandardConnectionResult }
  | { kind: 'error'; message: string; choice: WalletChoice };

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export const WalletPanel: React.FC = () => {
  const [status, setStatus] = useState<Status>({ kind: 'guest' });

  const connect = async (choice: WalletChoice) => {
    setStatus({ kind: 'connecting', choice });
    try {
      const connection = await connectStandardWallet(window, choice);
      setStatus({ kind: 'connected', connection });
    } catch (error) {
      setStatus({
        kind: 'error',
        choice,
        message: error instanceof Error ? error.message : 'Wallet connection failed.',
      });
    }
  };

  return (
    <section style={styles.panel} aria-labelledby="wallet-panel-title">
      <div style={styles.copy}>
        <span style={styles.eyebrow}>OPTIONAL FOR READING</span>
        <h2 id="wallet-panel-title" style={styles.title}>Connect a wallet</h2>
        <p style={styles.description}>
          Browse every public proposal as a guest. Connect only when you want an approved
          0x account ready for future signed governance actions.
        </p>
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          style={styles.primaryButton}
          onClick={() => void connect('ynx')}
          disabled={status.kind === 'connecting'}
        >
          {status.kind === 'connecting' && status.choice === 'ynx' ? 'Opening YNX Wallet…' : 'Connect YNX Wallet'}
        </button>
        <button
          type="button"
          style={styles.secondaryButton}
          onClick={() => void connect('metamask')}
          disabled={status.kind === 'connecting'}
        >
          {status.kind === 'connecting' && status.choice === 'metamask' ? 'Opening MetaMask…' : 'Use MetaMask'}
        </button>
        <a style={styles.downloadLink} href={YNX_WALLET_DOWNLOAD_URL}>Get YNX Wallet</a>
      </div>

      <div style={styles.status} role="status" aria-live="polite">
        {status.kind === 'guest' && <span><strong>Guest mode</strong> · Proposal reading is available without a wallet.</span>}
        {status.kind === 'connecting' && <span>Waiting for wallet approval. No governance action has been submitted.</span>}
        {status.kind === 'connected' && (
          <span>
            <strong>Standard wallet connected</strong> · {status.connection.walletName} ·{' '}
            <code title={status.connection.account}>{shortAddress(status.connection.account)}</code> · 0x1917
          </span>
        )}
        {status.kind === 'error' && <span><strong>Connection not completed</strong> · {status.message}</span>}
      </div>

      <div style={styles.boundary}>
        <strong>Private governance authority: unavailable</strong>
        <span>Connecting never grants voting, delegation, proposal, treasury, or emergency permissions.</span>
      </div>
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    maxWidth: '1352px', margin: '0 auto 24px', padding: '20px 24px', borderRadius: '18px',
    background: 'linear-gradient(135deg, #071B50 0%, #002FA7 70%, #164ED8 100%)', color: '#FFFFFF',
    display: 'grid', gridTemplateColumns: 'minmax(240px, 1.4fr) minmax(220px, 0.8fr)', gap: '20px',
    boxShadow: '0 18px 50px rgba(0, 47, 167, 0.18)',
  },
  copy: { minWidth: 0 },
  eyebrow: { fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', color: '#AFC8FF' },
  title: { fontSize: '25px', lineHeight: 1.15, margin: '7px 0 8px' },
  description: { margin: 0, color: '#DDE7FF', lineHeight: 1.55, maxWidth: '700px' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', gap: '10px' },
  primaryButton: { minHeight: '44px', border: 0, borderRadius: '10px', padding: '0 16px', background: '#FFFFFF', color: '#002FA7', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { minHeight: '44px', border: '1px solid #8BACFF', borderRadius: '10px', padding: '0 16px', background: 'transparent', color: '#FFFFFF', fontWeight: 700, cursor: 'pointer' },
  downloadLink: { color: '#FFFFFF', fontWeight: 700, padding: '10px 4px', textUnderlineOffset: '3px' },
  status: { gridColumn: '1 / -1', padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.10)', color: '#F4F7FF', overflowWrap: 'anywhere' },
  boundary: { gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: '13px', color: '#F8DCA1' },
};

