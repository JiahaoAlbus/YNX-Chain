import React, { useState } from 'react';
import { ProposalList } from './components/ProposalList';
import { ProposalDetail } from './components/ProposalDetail';

type View = 'list' | 'detail';

export const App: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);

  const handleSelectProposal = (id: string) => {
    setSelectedProposalId(id);
    setView('detail');
  };

  const handleBackToList = () => {
    setView('list');
    setSelectedProposalId(null);
  };

  return (
    <div style={styles.app}>
      <nav style={styles.nav}>
        <div style={styles.navContent}>
          <div style={styles.logo}>
            <span style={styles.logoText}>YNX</span>
            <span style={styles.logoSubtext}>Governance</span>
          </div>
          <div style={styles.navLinks}>
            <a href="/governance" style={styles.navLink}>Proposals</a>
            <a href="/governance/roles" style={styles.navLink}>Roles</a>
            <a href="/governance/emergencies" style={styles.navLink}>Emergency</a>
            <a href="/governance/docs" style={styles.navLink}>Docs</a>
          </div>
          <div style={styles.navRight}>
            <button style={styles.walletButton}>Connect Wallet</button>
          </div>
        </div>
      </nav>

      <main style={styles.main}>
        {view === 'list' && <ProposalList onSelectProposal={handleSelectProposal} />}
        {view === 'detail' && selectedProposalId && (
          <ProposalDetail proposalId={selectedProposalId} onBack={handleBackToList} />
        )}
      </main>

      <footer style={styles.footer}>
        <div style={styles.footerContent}>
          <div style={styles.footerSection}>
            <h3 style={styles.footerTitle}>YNX Governance</h3>
            <p style={styles.footerText}>
              Decentralized governance for YNX Chain protocol parameters, upgrades, and treasury.
            </p>
          </div>
          <div style={styles.footerSection}>
            <h4 style={styles.footerSubtitle}>Resources</h4>
            <a href="/docs/governance" style={styles.footerLink}>Documentation</a>
            <a href="/docs/governance/threat-model" style={styles.footerLink}>Threat Model</a>
            <a href="/docs/governance/operations" style={styles.footerLink}>Operations</a>
          </div>
          <div style={styles.footerSection}>
            <h4 style={styles.footerSubtitle}>Community</h4>
            <a href="https://forum.ynx.network" style={styles.footerLink}>Forum</a>
            <a href="https://github.com/ynx-chain" style={styles.footerLink}>GitHub</a>
            <a href="/explorer" style={styles.footerLink}>Explorer</a>
          </div>
        </div>
        <div style={styles.footerBottom}>
          <p style={styles.footerCopy}>© 2026 YNX Chain. Klein Blue #002FA7</p>
        </div>
      </footer>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#FAFAFA',
  },
  nav: {
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E0E0E0',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  navContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  logoText: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#002FA7',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
  },
  logoSubtext: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#757575',
  },
  navLinks: {
    display: 'flex',
    gap: '24px',
    flex: 1,
    justifyContent: 'center',
  },
  navLink: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#424242',
    textDecoration: 'none',
    transition: 'color 0.2s',
  },
  navRight: {},
  walletButton: {
    padding: '8px 16px',
    backgroundColor: '#002FA7',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  main: {
    flex: 1,
    padding: '24px 0',
  },
  footer: {
    backgroundColor: '#212121',
    color: '#FFFFFF',
    marginTop: '48px',
  },
  footerContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '48px 24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '32px',
  },
  footerSection: {},
  footerTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#FFFFFF',
  },
  footerSubtitle: {
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#FFFFFF',
  },
  footerText: {
    fontSize: '14px',
    color: '#BDBDBD',
    lineHeight: '1.6',
  },
  footerLink: {
    display: 'block',
    fontSize: '14px',
    color: '#BDBDBD',
    textDecoration: 'none',
    marginBottom: '8px',
    transition: 'color 0.2s',
  },
  footerBottom: {
    borderTop: '1px solid #424242',
    padding: '24px',
    textAlign: 'center',
  },
  footerCopy: {
    fontSize: '13px',
    color: '#9E9E9E',
    margin: 0,
  },
};
