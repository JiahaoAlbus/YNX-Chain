import React, { useEffect, useState } from 'react';

interface Proposal {
  id: string;
  nonce: string;
  scope: string;
  proposer: string;
  summary: string;
  status: string;
  createdAt: string;
  votingOpensAt?: string;
  votingClosesAt?: string;
  timelockEndsAt?: string;
}

interface ProposalListProps {
  onSelectProposal: (id: string) => void;
}

export const ProposalList: React.FC<ProposalListProps> = ({ onSelectProposal }) => {
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
        throw new Error('Failed to fetch proposals');
      }
      const data = await response.json();
      setProposals(data.proposals || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
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
      return ['deposit', 'discussion', 'voting', 'timelocked', 'executing'].includes(p.status);
    }
    if (filter === 'completed') {
      return ['executed', 'rejected', 'cancelled', 'expired', 'rolled_back'].includes(p.status);
    }
    return p.status === filter;
  });

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading proposals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>Error: {error}</div>
        <button onClick={fetchProposals} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Governance Proposals</h1>
        <div style={styles.filterBar}>
          <button
            onClick={() => setFilter('all')}
            style={{
              ...styles.filterButton,
              ...(filter === 'all' ? styles.filterButtonActive : {}),
            }}
          >
            All
          </button>
          <button
            onClick={() => setFilter('active')}
            style={{
              ...styles.filterButton,
              ...(filter === 'active' ? styles.filterButtonActive : {}),
            }}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('voting')}
            style={{
              ...styles.filterButton,
              ...(filter === 'voting' ? styles.filterButtonActive : {}),
            }}
          >
            Voting
          </button>
          <button
            onClick={() => setFilter('completed')}
            style={{
              ...styles.filterButton,
              ...(filter === 'completed' ? styles.filterButtonActive : {}),
            }}
          >
            Completed
          </button>
        </div>
      </div>

      <div style={styles.proposalGrid}>
        {filteredProposals.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No proposals found</p>
          </div>
        ) : (
          filteredProposals.map((proposal) => (
            <div
              key={proposal.id}
              style={styles.proposalCard}
              onClick={() => onSelectProposal(proposal.id)}
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
                <span style={styles.scope}>{proposal.scope}</span>
              </div>
              <h3 style={styles.proposalTitle}>{proposal.summary}</h3>
              <div style={styles.proposalMeta}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Proposer:</span>
                  <span style={styles.metaValue}>
                    {proposal.proposer.substring(0, 10)}...
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Created:</span>
                  <span style={styles.metaValue}>
                    {new Date(proposal.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {proposal.votingOpensAt && (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Voting Opens:</span>
                    <span style={styles.metaValue}>
                      {new Date(proposal.votingOpensAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '16px',
  },
  proposalCard: {
    padding: '20px',
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    backgroundColor: '#FFFFFF',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      boxShadow: '0 4px 12px rgba(0, 47, 167, 0.1)',
      borderColor: '#002FA7',
    },
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
