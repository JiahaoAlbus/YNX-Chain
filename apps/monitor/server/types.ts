export type Role =
  | 'viewer'
  | 'operator'
  | 'incident_commander'
  | 'backup_recovery'
  | 'security_reviewer';

export type Permission =
  | 'incident:create'
  | 'incident:manage'
  | 'incident:recovery_verify'
  | 'incident:postmortem'
  | 'alert:acknowledge'
  | 'backup:record'
  | 'backup:verify'
  | 'rollback:propose'
  | 'rollback:verify'
  | 'automation:propose'
  | 'automation:review';

export type IncidentStatus =
  | 'open'
  | 'acknowledged'
  | 'investigating'
  | 'mitigated'
  | 'recovery_verifying'
  | 'resolved'
  | 'postmortem_complete';

export type IncidentAction =
  | 'acknowledge'
  | 'investigate'
  | 'mitigate'
  | 'begin_recovery'
  | 'verify_recovery'
  | 'reopen';

export interface Principal { username:string; role:Role }
export interface AuditEvent { id:string; at:string; actor:string; role:Role; action:string; target:string; outcome:string; evidence?:Record<string,unknown> }
export interface IncidentTimelineEntry {
  id:string;
  at:string;
  actor:string;
  role:Role;
  action:string;
  summary:string;
  evidence:string[];
}
export interface IncidentPostmortem {
  summary:string;
  rootCause:string;
  correctiveActions:string[];
  evidence:string[];
  completedAt:string;
  completedBy:string;
}
export interface Incident {
  schemaVersion:1;
  id:string;
  title:string;
  severity:'low'|'medium'|'high'|'critical';
  status:IncidentStatus;
  openedAt:string;
  source:string;
  evidence:string[];
  notes:string[];
  owner?:string;
  acknowledgedAt?:string;
  mitigatedAt?:string;
  recoveryVerifiedAt?:string;
  resolvedAt?:string;
  timeline:IncidentTimelineEntry[];
  postmortem?:IncidentPostmortem;
}
export interface BackupVerification {
  result:'verified'|'rejected';
  digestMatch:boolean;
  accessible:boolean;
  verifiedAt:string;
  verifiedBy:string;
  evidence:string[];
  notes:string;
}
export interface BackupArtifact {
  schemaVersion:1;
  id:string;
  kind:'state'|'database'|'configuration'|'release'|'other';
  service:string;
  artifactRef:string;
  digestAlgorithm:'sha256';
  digest:string;
  sizeBytes:number;
  createdAt:string;
  registeredAt:string;
  registeredBy:string;
  retentionClass:string;
  retentionUntil:string;
  storageLocation:string;
  encryption:'encrypted'|'unknown';
  rpoTargetSeconds:number;
  rtoTargetSeconds:number;
  evidence:string[];
  status:'pending_verification'|'verified'|'rejected';
  verification?:BackupVerification;
}
export interface RestoreDrillVerification {
  result:'accepted'|'rejected';
  verifiedAt:string;
  verifiedBy:string;
  evidence:string[];
  notes:string;
}
export interface RestoreDrill {
  schemaVersion:1;
  id:string;
  backupId:string;
  environment:string;
  startedAt:string;
  completedAt:string;
  reportedAt:string;
  reportedBy:string;
  reportedResult:'passed'|'failed';
  rpoObservedSeconds:number;
  rtoObservedSeconds:number;
  integrityVerified:boolean;
  applicationVerified:boolean;
  evidence:string[];
  failureReason?:string;
  status:'pending_verification'|'verified_passed'|'verified_failed';
  verification?:RestoreDrillVerification;
}
export interface RollbackVerification {
  result:'verified'|'rejected';
  verifiedAt:string;
  verifiedBy:string;
  evidence:string[];
  notes:string;
}
export interface RollbackProposal {
  schemaVersion:1;
  id:string;
  candidateRelease:string;
  previousRelease?:string;
  reason:string;
  dryRunEvidence:string[];
  status:'approved-not-executed'|'verified-not-executed'|'rejected-not-executed';
  approvedBy:string;
  approvedAt:string;
  executionBoundary:'central infrastructure owner';
  verification?:RollbackVerification;
}
export interface AutomationReview {
  decision:'approved'|'rejected';
  reviewedAt:string;
  reviewedBy:string;
  evidence:string[];
  notes:string;
}
export interface AutomationProposal {
  schemaVersion:1;
  id:string;
  action:'pause'|'resume';
  target:string;
  reason:string;
  evidence:string[];
  requestedBy:string;
  requestedAt:string;
  expiresAt:string;
  maxPauseSeconds?:number;
  pauseProposalId?:string;
  status:'pending_review'|'approved-not-executed'|'rejected-not-executed'|'expired-not-executed';
  executionBoundary:'central infrastructure owner';
  authorityBoundary:'pause-or-resume-only; no asset movement or authority expansion';
  review?:AutomationReview;
}
export interface Alert { id:string; source:string; state:'firing'|'acknowledged'|'resolved'; firstObservedAt:string; lastObservedAt:string; reason:string; evidenceUrl:string; acknowledgedBy?:string; acknowledgedAt?:string }
export interface WalletChallenge { id:string; nonceHash:string; accountHint?:string; origin:string; issuedAt:string; expiresAt:string; consumedAt?:string }
export interface OpsState {
  incidents:Incident[];
  alerts:Alert[];
  audits:AuditEvent[];
  rollbackProposals:Array<RollbackProposal|Record<string,unknown>>;
  automationProposals:Array<AutomationProposal|Record<string,unknown>>;
  backupRecords:Array<BackupArtifact|Record<string,unknown>>;
  restoreDrills:RestoreDrill[];
  walletChallenges:WalletChallenge[];
}
