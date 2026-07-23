import React, { useEffect, useState } from 'react';

interface ProposalDetail {
  id: string;
  nonce: string;
  scope: string;
  proposer: string;
  owner: string;
  summary: string;
  economicImpact: string;
  securityRisk: string;
  migration: string;
  rollback: string;
  evidence: string[];
  changes: Array<{
    path: string;
    before: string;
    after: string;
    minimum?: number;
    maximum?: number;
  }>;
  status: string;
  createdAt: string;
  votingOpensAt?: string;
  votingClosesAt?: string;
  timelockEndsAt?: string;
  executedAt?: string;
  upgradeHash?: string;
}

interface Vote {
  account: string;
  position: string;
  power: number;
  castAt: string;
}

interface VotingStats {
  totalVotes: number;
  approveCount: number;
  rejectCount: number;
  abstainCount: number;
  approvePower: number;
  rejectPower: number;
  abstainPower: number;
  quorumReached: boolean;
  thresholdReached: boolean;
}

interface ProposalDetailProps {
  proposalId: string;
  onBack: () => void;
}

export const ProposalDetail: React.FC<ProposalDetailProps> = ({ proposalId, onBack }) => {
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [stats, setStats] = useState<VotingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    fetchProposalDetail();
  }, [proposalId]);

  const fetchProposalDetail = async () => {
    try {
      setLoading(true);
      const [proposalRes, votesRes, statsRes] = await Promise.all([
        fetch(`/governance/proposals/${proposalId}`),
        fetch(`/governance/proposals/${proposalId}/votes`),
        fetch(`/governance/proposals/${proposalId}/stats`),
      ]);

      if (!proposalRes.ok) throw new Error('Failed to fetch proposal');

      const proposalData = await proposalRes.json();
      const votesData = votesRes.ok ? await votesRes.json() : { votes: [] };
      const statsData = statsRes.ok ? await statsRes.json() : null;

      setProposal(proposalData);
      setVotes(votesData.votes || []);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (position: 'approve' | 'reject' | 'abstain') => {
    try {
      setVoting(true);
      const response = await fetch(`/governance/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position }),
      });

      if (!response.ok) {
        throw new Error('Failed to cast vote');
      }

      // Refresh data
      await fetchProposalDetail();
      alert(`Vote cast: ${position}`);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setVoting(false);
    }
  };

  const getRemainingTime = (timestamp?: string): string => {
    if (!timestamp) return 'N/A';
    const now = new Date().getTime();
    const target = new Date(timestamp).getTime();
    const diff = target - now;

    if (diff < 0) return 'Expired';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  if (loading) {
    return <div style={styles.loading}>Loading proposal...</div>;
  }

  if (error || !proposal) {
    return (
      <div style={styles.container}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <div style={styles.error}>Error: {error || 'Proposal not found'}</div>
      </div>
    );
  }

  const canVote = proposal.status === 'voting';

  return (
    <div style={styles.container}>
      <button onClick={onBack} style={styles.backButton}>← Back to Proposals</button>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>{proposal.summary}</h1>
          <span style={{...styles.statusBadge, backgroundColor: getStatusColor(proposal.status)}}>
            {proposal.status.toUpperCase()}
          </span>
        </div>
        <div style={styles.meta}>
          <span style={styles.metaItem}>Scope: <strong>{proposal.scope}</strong></span>
          <span style={styles.metaItem}>ID: <strong>{proposal.id.substring(0, 16)}...</strong></span>
        </div>
      </div>

      {/* Voting Stats */}
      {stats && (
        <div style={styles.statsCard}>
          <h2 style={styles.sectionTitle}>Voting Results</h2>
          <div style={styles.statsGrid}>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>Approve</div>
              <div style={styles.statValue}>{stats.approveCount}</div>
              <div style={styles.statPower}>{stats.approvePower} power</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>Reject</div>
              <div style={styles.statValue}>{stats.rejectCount}</div>
              <div style={styles.statPower}>{stats.rejectPower} power</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>Abstain</div>
              <div style={styles.statValue}>{stats.abstainCount}</div>
              <div style={styles.statPower}>{stats.abstainPower} power</div>
            </div>
          </div>
          <div style={styles.statsRow}>
            <span>Quorum: {stats.quorumReached ? '✓ Reached' : '✗ Not reached'}</span>
            <span>Threshold: {stats.thresholdReached ? '✓ Reached' : '✗ Not reached'}</span>
          </div>
        </div>
      )}

      {/* Voting Actions */}
      {canVote && (
        <div style={styles.votingCard}>
          <h2 style={styles.sectionTitle}>Cast Your Vote</h2>
          <div style={styles.votingButtons}>
            <button
              onClick={() => handleVote('approve')}
              disabled={voting}
              style={{...styles.voteButton, backgroundColor: '#66BB6A'}}
            >
              Approve
            </button>
            <button
              onClick={() => handleVote('reject')}
              disabled={voting}
              style={{...styles.voteButton, backgroundColor: '#EF5350'}}
            >
              Reject
            </button>
            <button
              onClick={() => handleVote('abstain')}
              disabled={voting}
              style={{...styles.voteButton, backgroundColor: '#9E9E9E'}}
            >
              Abstain
            </button>
          </div>
          {proposal.votingClosesAt && (
            <div style={styles.deadline}>
              Voting closes in: {getRemainingTime(proposal.votingClosesAt)}
            </div>
          )}
        </div>
      )}

      {/* Timelock */}
      {proposal.status === 'timelocked' && proposal.timelockEndsAt && (
        <div style={styles.timelockCard}>
          <h2 style={styles.sectionTitle}>⏱ Timelock Active</h2>
          <p style={styles.timelockText}>
            This proposal is in timelock period. Execution allowed in: {getRemainingTime(proposal.timelockEndsAt)}
          </p>
        </div>
      )}

      {/* Details */}
      <div style={styles.detailsCard}>
        <h2 style={styles.sectionTitle}>Proposal Details</h2>
        
        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>Economic Impact</h3>
          <p style={styles.detailText}>{proposal.economicImpact}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>Security Risk</h3>
          <p style={styles.detailText}>{proposal.securityRisk}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>Migration</h3>
          <p style={styles.detailText}>{proposal.migration}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>Rollback Plan</h3>
          <p style={styles.detailText}>{proposal.rollback}</p>
        </div>
      </div>

      {/* Parameter Changes */}
      {proposal.changes && proposal.changes.length > 0 && (
        <div style={styles.changesCard}>
          <h2 style={styles.sectionTitle}>Parameter Changes</h2>
          {proposal.changes.map((change, index) => (
            <div key={index} style={styles.changeRow}>
              <div style={styles.changePath}>{change.path}</div>
              <div style={styles.changeValues}>
                <span style={styles.oldValue}>{change.before}</span>
                <span style={styles.arrow}>→</span>
                <span style={styles.newValue}>{change.after}</span>
              </div>
              {(change.minimum !== undefined || change.maximum !== undefined) && (
                <div style={styles.changeBounds}>
                  Bounds: [{change.minimum ?? 'none'}, {change.maximum ?? 'none'}]
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Evidence */}
      {proposal.evidence && proposal.evidence.length > 0 && (
        <div style={styles.evidenceCard}>
          <h2 style={styles.sectionTitle}>Evidence & Documentation</h2>
          {proposal.evidence.map((link, index) => (
            <a key={index} href={link} target="_blank" rel="noopener noreferrer" style={styles.evidenceLink}>
              {link}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'deposit': return '#FFA726';
    case 'discussion': return '#42A5F5';
    case 'voting': return '#66BB6A';
    case 'timelocked': return '#AB47BC';
    case 'executed': return '#26A69A';
    case 'rejected':
    case 'cancelled':
    case 'expired': return '#EF5350';
    default: return '#78909C';
  }
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  },
  backButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #E0E0E0',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#424242',
    cursor: 'pointer',
    marginBottom: '24px',
  },
  header: {
    marginBottom: '24px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '600',
    color: '#002FA7',
    margin: 0,
    flex: 1,
  },
  statusBadge: {
    padding: '6px 16px',
    borderRadius: '16px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: '0.5px',
    marginLeft: '16px',
  },
  meta: {
    display: 'flex',
    gap: '24px',
    fontSize: '14px',
    color: '#757575',
  },
  metaItem: {},
  statsCard: {
    padding: '24px',
    backgroundColor: '#F5F5F5',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#212121',
    marginBottom: '16px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '16px',
  },
  statBox: {
    padding: '16px',
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    textAlign: 'center',
  },
  statLabel: {
    fontSize: '12px',
    color: '#757575',
    marginBottom: '8px',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#002FA7',
    marginBottom: '4px',
  },
  statPower: {
    fontSize: '12px',
    color: '#757575',
  },
  statsRow: {
    display: 'flex',
    justifyContent: 'space-around',
    fontSize: '14px',
    color: '#424242',
  },
  votingCard: {
    padding: '24px',
    backgroundColor: '#E3F2FD',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  votingButtons: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    marginBottom: '16px',
  },
  voteButton: {
    padding: '16px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    color: '#FFFFFF',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  deadline: {
    textAlign: 'center',
    fontSize: '14px',
    color: '#1565C0',
    fontWeight: '500',
  },
  timelockCard: {
    padding: '24px',
    backgroundColor: '#F3E5F5',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  timelockText: {
    fontSize: '16px',
    color: '#6A1B9A',
    margin: 0,
  },
  detailsCard: {
    padding: '24px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  detailSection: {
    marginBottom: '20px',
  },
  detailLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#424242',
    marginBottom: '8px',
  },
  detailText: {
    fontSize: '14px',
    color: '#616161',
    lineHeight: '1.6',
    margin: 0,
  },
  changesCard: {
    padding: '24px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  changeRow: {
    padding: '16px',
    backgroundColor: '#FAFAFA',
    borderRadius: '8px',
    marginBottom: '12px',
  },
  changePath: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#002FA7',
    fontFamily: 'monospace',
    marginBottom: '8px',
  },
  changeValues: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
  },
  oldValue: {
    color: '#EF5350',
    textDecoration: 'line-through',
  },
  arrow: {
    color: '#9E9E9E',
  },
  newValue: {
    color: '#66BB6A',
    fontWeight: '600',
  },
  changeBounds: {
    fontSize: '12px',
    color: '#757575',
    marginTop: '8px',
  },
  evidenceCard: {
    padding: '24px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E0E0E0',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  evidenceLink: {
    display: 'block',
    padding: '12px',
    backgroundColor: '#F5F5F5',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#002FA7',
    textDecoration: 'none',
    marginBottom: '8px',
    wordBreak: 'break-all',
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
  },
};
