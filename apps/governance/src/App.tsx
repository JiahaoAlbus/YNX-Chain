import React, { useState } from 'react';
import { ProposalList } from './components/ProposalList';
import { ProposalDetail } from './components/ProposalDetail';
import { I18nProvider, Locale, supportedLocales, useI18n } from './i18n';
import { WalletPanel } from './wallet/WalletPanel';

type View = 'list' | 'detail';

const GovernanceApp: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const { locale, setLocale, t, dir, localeNames } = useI18n();

  const handleSelectProposal = (id: string) => {
    setSelectedProposalId(id);
    setView('detail');
  };

  const handleBackToList = () => {
    setView('list');
    setSelectedProposalId(null);
  };

  return (
    <div style={styles.app} lang={locale} dir={dir}>
      <nav style={styles.nav} aria-label={t('proposals')}>
        <div style={styles.navContent}>
          <div style={styles.logo}>
            <span style={styles.logoText}>YNX</span>
            <span style={styles.logoSubtext}>Governance</span>
          </div>
          <div style={styles.navLinks}>
            <a href="/governance" style={styles.navLink}>{t('proposals')}</a>
            <a href="/governance/roles" style={styles.navLink}>{t('roles')}</a>
            <a href="/governance/emergencies" style={styles.navLink}>{t('emergency')}</a>
            <a href="/governance/docs" style={styles.navLink}>{t('docs')}</a>
          </div>
          <label style={styles.languageLabel}>
            <span>{t('language')}</span>
            <select
              aria-label={t('language')}
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
              style={styles.languageSelect}
            >
              {supportedLocales.map((code) => <option key={code} value={code}>{localeNames[code]}</option>)}
            </select>
          </label>
          <a href="/docs/governance/operations" style={styles.operatorLink}>{t('operatorGuide')}</a>
        </div>
      </nav>

      <main style={styles.main}>
        <WalletPanel />
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
              {t('description')}
            </p>
          </div>
          <div style={styles.footerSection}>
            <h4 style={styles.footerSubtitle}>{t('resources')}</h4>
            <a href="/docs/governance" style={styles.footerLink}>{t('documentation')}</a>
            <a href="/docs/governance/threat-model" style={styles.footerLink}>{t('threatModel')}</a>
            <a href="/docs/governance/operations" style={styles.footerLink}>{t('operations')}</a>
          </div>
          <div style={styles.footerSection}>
            <h4 style={styles.footerSubtitle}>{t('community')}</h4>
            <a href="https://forum.ynx.network" style={styles.footerLink}>Forum</a>
            <a href="https://github.com/ynx-chain" style={styles.footerLink}>GitHub</a>
            <a href="/explorer" style={styles.footerLink}>{t('explorer')}</a>
          </div>
        </div>
        <div style={styles.footerBottom}>
          <p style={styles.footerCopy}>© 2026 YNX Chain. Klein Blue #002FA7</p>
        </div>
      </footer>
    </div>
  );
};

export const App = ({ initialLocale = 'en' }: { initialLocale?: Locale }) => (
  <I18nProvider initialLocale={initialLocale}><GovernanceApp /></I18nProvider>
);

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
    gap: '16px',
    flexWrap: 'wrap',
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
    flexWrap: 'wrap',
  },
  navLink: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#424242',
    textDecoration: 'none',
    transition: 'color 0.2s',
  },
  operatorLink: {
    padding: '8px 16px',
    backgroundColor: '#002FA7',
    color: '#FFFFFF',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    textDecoration: 'none',
    transition: 'background-color 0.2s',
  },
  languageLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#424242',
  },
  languageSelect: {
    minHeight: '40px',
    maxWidth: '180px',
    border: '1px solid #757575',
    borderRadius: '8px',
    backgroundColor: '#FFFFFF',
    color: '#212121',
    padding: '6px 8px',
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
