import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface Proposal {
  id: string;
  status: string;
  createdAt: string;
  votingEndsAt?: string;
  executeAfter?: string;
  input: {
    nonce: string;
    scope: string;
    proposer: string;
    summary: string;
  };
}

interface ProposalListProps {
  onSelectProposal: (id: string) => void;
}

export const ProposalList: React.FC<ProposalListProps> = ({ onSelectProposal }) => {
  const { locale, t } = useI18n();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      setLoading(true);
      const response = await fetch('/governance/proposals');
      if (!response.ok) {
        throw new Error(t('failedProposals'));
      }
      const data = await response.json();
      setProposals(data.proposals || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'deposit':
        return '#FFA726'; // Orange
      case 'discussion':
        return '#42A5F5'; // Blue
      case 'voting':
        return '#66BB6A'; // Green
      case 'timelocked':
        return '#AB47BC'; // Purple
      case 'executed':
        return '#26A69A'; // Teal
      case 'rejected':
      case 'cancelled':
      case 'expired':
        return '#EF5350'; // Red
      default:
        return '#78909C'; // Grey
    }
  };

  const filteredProposals = proposals.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'active') {
      return [
        'deposit_pending',
        'discussion',
        'technical_review',
        'economic_review',
        'security_review',
        'conflict_disclosure',
        'simulation_pending',
        'simulation_completed',
        'voting_pending',
        'voting_active',
        'voting_closed',
        'approved',
        'timelock_pending',
        'timelock_active',
        'execution_ready',
        'execution_submitted',
        'verification_pending',
      ].includes(p.status);
    }
    if (filter === 'completed') {
      return [
        'verified',
        'quorum_failed',
        'threshold_failed',
        'cancelled',
        'expired',
        'execution_failed',
        'rolled_back',
        'corrected',
        'archived',
      ].includes(p.status);
    }
    return p.status === filter;
  });

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading} role="status" aria-live="polite">{t('loadingProposals')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error} role="alert">{t('error')}: {error}</div>
        <button type="button" onClick={fetchProposals} style={styles.retryButton}>
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('governanceProposals')}</h1>
        <div style={styles.filterBar} role="group" aria-label={t('governanceProposals')}>
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
            style={{
              ...styles.filterButton,
              ...(filter === 'all' ? styles.filterButtonActive : {}),
            }}
          >
            {t('all')}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'active'}
            onClick={() => setFilter('active')}
            style={{
              ...styles.filterButton,
              ...(filter === 'active' ? styles.filterButtonActive : {}),
            }}
          >
            {t('active')}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'voting_active'}
            onClick={() => setFilter('voting_active')}
            style={{
              ...styles.filterButton,
              ...(filter === 'voting_active' ? styles.filterButtonActive : {}),
            }}
          >
            {t('voting')}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'completed'}
            onClick={() => setFilter('completed')}
            style={{
              ...styles.filterButton,
              ...(filter === 'completed' ? styles.filterButtonActive : {}),
            }}
          >
            {t('completed')}
          </button>
        </div>
      </div>

      <div style={styles.proposalGrid}>
        {filteredProposals.length === 0 ? (
          <div style={styles.emptyState}>
            <p>{t('noProposals')}</p>
          </div>
        ) : (
          filteredProposals.map((proposal) => (
            <button
              type="button"
              key={proposal.id}
              style={styles.proposalCard}
              onClick={() => onSelectProposal(proposal.id)}
              aria-label={`${t('openProposal')}: ${proposal.input.summary}`}
            >
              <div style={styles.proposalHeader}>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: getStatusColor(proposal.status),
                  }}
                >
                  {proposal.status.toUpperCase()}
                </span>
                <span style={styles.scope}>{proposal.input.scope}</span>
              </div>
              <h3 style={styles.proposalTitle}>{proposal.input.summary}</h3>
              <div style={styles.proposalMeta}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>{t('proposer')}:</span>
                  <span style={styles.metaValue}>
                    {proposal.input.proposer.substring(0, 10)}...
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>{t('created')}:</span>
                  <span style={styles.metaValue}>
                    {new Date(proposal.createdAt).toLocaleDateString(locale)}
                  </span>
                </div>
                {proposal.votingEndsAt && (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>{t('votingEnds')}:</span>
                    <span style={styles.metaValue}>
                      {new Date(proposal.votingEndsAt).toLocaleDateString(locale)}
                    </span>
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  },
  header: {
    marginBottom: '32px',
  },
  title: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#002FA7',
    marginBottom: '16px',
  },
  filterBar: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  filterButton: {
    padding: '8px 16px',
    border: '1px solid #E0E0E0',
    borderRadius: '8px',
    backgroundColor: '#FFFFFF',
    color: '#424242',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  filterButtonActive: {
    backgroundColor: '#002FA7',
    color: '#FFFFFF',
    borderColor: '#002FA7',
  },
  proposalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
    gap: '16px',
  },
  proposalCard: {
    padding: '20px',
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    backgroundColor: '#FFFFFF',
    cursor: 'pointer',
    transition: 'all 0.2s',
    width: '100%',
    textAlign: 'start',
    color: 'inherit',
    font: 'inherit',
  },
  proposalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: '0.5px',
  },
  scope: {
    fontSize: '12px',
    color: '#757575',
    fontWeight: '500',
  },
  proposalTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#212121',
    marginBottom: '12px',
    lineHeight: '1.4',
  },
  proposalMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  metaLabel: {
    color: '#757575',
    fontWeight: '500',
  },
  metaValue: {
    color: '#424242',
    fontWeight: '400',
  },
  loading: {
    textAlign: 'center',
    padding: '48px',
    fontSize: '16px',
    color: '#757575',
  },
  error: {
    padding: '24px',
    backgroundColor: '#FFEBEE',
    color: '#C62828',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: '#002FA7',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px',
    gridColumn: '1 / -1',
    color: '#757575',
  },
};
