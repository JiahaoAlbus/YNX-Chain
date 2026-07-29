import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface ProposalDetail {
  id: string;
  status: string;
  createdAt: string;
  votingEndsAt?: string;
  executeAfter?: string;
  eligiblePower: number;
  input: {
    nonce: string;
    scope: string;
    proposer: string;
    owner: string;
    summary: string;
    economicImpact: string;
    technicalImpact: string;
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
    upgradeHash?: string;
    conflictDisclosure: string;
  };
  conflicts: Record<string, {
    actor: string;
    description: string;
    recused: boolean;
    disclosedAt: string;
  }>;
  transitions: Array<{
    actor: string;
    to: string;
    at: string;
    auditHash: string;
  }>;
  executionHash?: string;
  executionReceipt?: {
    txHash: string;
    blockHeight: number;
    manifestHash: string;
    outcome: string;
    auditHash: string;
  };
}

interface Vote {
  proposalId: string;
  voter: string;
  choice?: string;
  operation: string;
  currentRevision: boolean;
  power: number;
  castAt: string;
}

interface VotingStats {
  yesCount: number;
  noCount: number;
  abstainCount: number;
  yesPower: number;
  noPower: number;
  abstainPower: number;
}

interface ProposalDetailProps {
  proposalId: string;
  onBack: () => void;
}

export const ProposalDetail: React.FC<ProposalDetailProps> = ({ proposalId, onBack }) => {
  const { locale, t } = useI18n();
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [stats, setStats] = useState<VotingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProposalDetail();
  }, [proposalId]);

  const fetchProposalDetail = async () => {
    try {
      setLoading(true);
      const [proposalRes, votesRes] = await Promise.all([
        fetch(`/governance/proposals/${proposalId}`),
        fetch('/votes'),
      ]);

      if (!proposalRes.ok) throw new Error(t('failedProposal'));

      const proposalData = await proposalRes.json();
      const votesData = votesRes.ok ? await votesRes.json() : { votes: [] };
      const currentVotes = (votesData.votes as Vote[]).filter(
        (vote) => vote.proposalId === proposalId && vote.currentRevision && vote.operation !== 'withdraw',
      );

      setProposal(proposalData);
      setVotes(currentVotes);
      setStats({
        yesCount: currentVotes.filter((vote) => vote.choice === 'yes').length,
        noCount: currentVotes.filter((vote) => vote.choice === 'no').length,
        abstainCount: currentVotes.filter((vote) => vote.choice === 'abstain').length,
        yesPower: currentVotes.filter((vote) => vote.choice === 'yes').reduce((sum, vote) => sum + vote.power, 0),
        noPower: currentVotes.filter((vote) => vote.choice === 'no').reduce((sum, vote) => sum + vote.power, 0),
        abstainPower: currentVotes.filter((vote) => vote.choice === 'abstain').reduce((sum, vote) => sum + vote.power, 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const getRemainingTime = (timestamp?: string): string => {
    if (!timestamp) return t('notAvailable');
    const now = new Date().getTime();
    const target = new Date(timestamp).getTime();
    const diff = target - now;

    if (diff < 0) return t('expired');

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  if (loading) {
    return <div style={styles.loading} role="status" aria-live="polite">{t('loadingProposal')}</div>;
  }

  if (error || !proposal) {
    return (
      <div style={styles.container}>
        <button type="button" onClick={onBack} style={styles.backButton}>← {t('back')}</button>
        <div style={styles.error} role="alert">{t('error')}: {error || t('proposalNotFound')}</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <button type="button" onClick={onBack} style={styles.backButton}>← {t('backToProposals')}</button>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>{proposal.input.summary}</h1>
          <span style={{...styles.statusBadge, backgroundColor: getStatusColor(proposal.status)}}>
            {proposal.status.toUpperCase()}
          </span>
        </div>
        <div style={styles.meta}>
          <span style={styles.metaItem}>{t('scope')}: <strong>{proposal.input.scope}</strong></span>
          <span style={styles.metaItem}>{t('id')}: <strong>{proposal.id.substring(0, 16)}...</strong></span>
        </div>
      </div>

      {/* Voting Stats */}
      {stats && (
        <div style={styles.statsCard}>
          <h2 style={styles.sectionTitle}>{t('votingResults')}</h2>
          <div style={styles.statsGrid}>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>{t('yes')}</div>
              <div style={styles.statValue}>{stats.yesCount}</div>
              <div style={styles.statPower}>{stats.yesPower} {t('power')}</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>{t('no')}</div>
              <div style={styles.statValue}>{stats.noCount}</div>
              <div style={styles.statPower}>{stats.noPower} {t('power')}</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>{t('abstain')}</div>
              <div style={styles.statValue}>{stats.abstainCount}</div>
              <div style={styles.statPower}>{stats.abstainPower} {t('power')}</div>
            </div>
          </div>
          <div style={styles.statsRow}>{t('eligiblePower')}: {proposal.eligiblePower}</div>
        </div>
      )}

      {votes.length > 0 && (
        <div style={styles.detailsCard}>
          <h2 style={styles.sectionTitle}>{t('recordedVotes')}</h2>
          {votes.map((vote) => (
            <div key={`${vote.voter}-${vote.castAt}`} style={styles.voteRecord}>
              <span>{vote.voter}</span>
              <strong>{vote.choice}</strong>
              <span>{vote.power} {t('power')}</span>
              <time dateTime={vote.castAt}>{new Date(vote.castAt).toLocaleString(locale)}</time>
            </div>
          ))}
        </div>
      )}

      {proposal.status === 'voting_active' && (
        <div style={styles.votingCard}>
          <h2 style={styles.sectionTitle}>{t('votingActive')}</h2>
          <p style={styles.timelockText}>
            {t('signedVoteNotice')}
          </p>
          {proposal.votingEndsAt && (
            <div style={styles.deadline}>
              {t('votingClosesIn')}: {getRemainingTime(proposal.votingEndsAt)}
            </div>
          )}
        </div>
      )}

      {/* Timelock */}
      {proposal.status === 'timelock_active' && proposal.executeAfter && (
        <div style={styles.timelockCard}>
          <h2 style={styles.sectionTitle}>⏱ {t('timelockActive')}</h2>
          <p style={styles.timelockText}>
            {t('timelockNotice')}: {getRemainingTime(proposal.executeAfter)}
          </p>
        </div>
      )}

      {/* Details */}
      <div style={styles.detailsCard}>
        <h2 style={styles.sectionTitle}>{t('proposalDetails')}</h2>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>{t('technicalImpact')}</h3>
          <p style={styles.detailText}>{proposal.input.technicalImpact}</p>
        </div>
        
        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>{t('economicImpact')}</h3>
          <p style={styles.detailText}>{proposal.input.economicImpact}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>{t('securityRisk')}</h3>
          <p style={styles.detailText}>{proposal.input.securityRisk}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>{t('migration')}</h3>
          <p style={styles.detailText}>{proposal.input.migration}</p>
        </div>

        <div style={styles.detailSection}>
          <h3 style={styles.detailLabel}>{t('rollbackPlan')}</h3>
          <p style={styles.detailText}>{proposal.input.rollback}</p>
        </div>
      </div>

      <section style={styles.detailsCard} aria-labelledby="conflict-title">
        <h2 id="conflict-title" style={styles.sectionTitle}>{t('conflictDisclosure')}</h2>
        <p style={styles.detailText}>{proposal.input.conflictDisclosure}</p>
        <h3 style={styles.detailLabel}>{t('conflicts')}</h3>
        {Object.values(proposal.conflicts || {}).length === 0 ? (
          <p style={styles.detailText}>{t('noRecords')}</p>
        ) : Object.values(proposal.conflicts).map((conflict) => (
          <div key={`${conflict.actor}-${conflict.disclosedAt}`} style={styles.auditRow}>
            <strong>{conflict.actor}</strong>
            <span>{conflict.description}</span>
            <span>{conflict.recused ? t('recused') : t('notRecused')}</span>
            <time dateTime={conflict.disclosedAt}>{new Date(conflict.disclosedAt).toLocaleString(locale)}</time>
          </div>
        ))}
      </section>

      {/* Parameter Changes */}
      {proposal.input.changes.length > 0 && (
        <div style={styles.changesCard}>
          <h2 style={styles.sectionTitle}>{t('parameterChanges')}</h2>
          {proposal.input.changes.map((change, index) => (
            <div key={index} style={styles.changeRow}>
              <div style={styles.changePath}>{change.path}</div>
              <div style={styles.changeValues}>
                <span style={styles.oldValue}>{change.before}</span>
                <span style={styles.arrow}>→</span>
                <span style={styles.newValue}>{change.after}</span>
              </div>
              {(change.minimum !== undefined || change.maximum !== undefined) && (
                <div style={styles.changeBounds}>
                  {t('bounds')}: [{change.minimum ?? t('none')}, {change.maximum ?? t('none')}]
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(proposal.executionHash || proposal.executionReceipt) && (
        <section style={styles.detailsCard} aria-labelledby="execution-title">
          <h2 id="execution-title" style={styles.sectionTitle}>{t('execution')}</h2>
          <dl style={styles.definitionList}>
            <dt>{t('manifest')}</dt><dd>{proposal.executionReceipt?.manifestHash || proposal.executionHash}</dd>
            {proposal.executionReceipt && <>
              <dt>{t('transaction')}</dt><dd>{proposal.executionReceipt.txHash}</dd>
              <dt>{t('block')}</dt><dd>{proposal.executionReceipt.blockHeight}</dd>
              <dt>{t('outcome')}</dt><dd>{proposal.executionReceipt.outcome}</dd>
            </>}
          </dl>
        </section>
      )}

      <section style={styles.detailsCard} aria-labelledby="audit-title">
        <h2 id="audit-title" style={styles.sectionTitle}>{t('auditTrail')}</h2>
        {(proposal.transitions || []).length === 0 ? <p>{t('noRecords')}</p> : proposal.transitions.map((transition) => (
          <div key={transition.auditHash} style={styles.auditRow}>
            <span><strong>{t('actor')}:</strong> {transition.actor}</span>
            <span><strong>{t('action')}:</strong> {transition.to}</span>
            <time dateTime={transition.at}><strong>{t('at')}:</strong> {new Date(transition.at).toLocaleString(locale)}</time>
            <code style={styles.auditHash}>{transition.auditHash}</code>
          </div>
        ))}
      </section>

      {/* Evidence */}
      {proposal.input.evidence.length > 0 && (
        <div style={styles.evidenceCard}>
          <h2 style={styles.sectionTitle}>{t('evidence')}</h2>
          {proposal.input.evidence.map((link, index) => (
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
    gap: '12px',
    flexWrap: 'wrap',
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
    flexWrap: 'wrap',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
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
  voteRecord: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '16px',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #E0E0E0',
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
  votingCard: {
    padding: '24px',
    backgroundColor: '#E3F2FD',
    borderRadius: '12px',
    marginBottom: '24px',
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
  auditRow: {
    display: 'grid',
    gap: '8px',
    padding: '12px 0',
    borderBottom: '1px solid #E0E0E0',
    overflowWrap: 'anywhere',
  },
  auditHash: {
    fontSize: '12px',
    overflowWrap: 'anywhere',
  },
  definitionList: {
    display: 'grid',
    gridTemplateColumns: 'minmax(100px, auto) minmax(0, 1fr)',
    gap: '8px 16px',
    overflowWrap: 'anywhere',
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
