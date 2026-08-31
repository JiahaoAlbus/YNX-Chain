import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  Alert,
  AutomationProposal,
  AuditEvent,
  BackupArtifact,
  Incident,
  IncidentAction,
  IncidentStatus,
  OpsState,
  Principal,
  RestoreDrill,
  Role,
  RollbackProposal,
  WalletChallenge,
} from './types.js';

const empty = (): OpsState => ({ incidents:[], alerts:[], audits:[], rollbackProposals:[], automationProposals:[], backupRecords:[], restoreDrills:[], walletChallenges:[] });
const stable=(value:unknown)=>JSON.stringify(value);
const incidentStatuses:readonly IncidentStatus[]=['open','acknowledged','investigating','mitigated','recovery_verifying','resolved','postmortem_complete'];

function normalizeIncident(input:Partial<Incident>&Record<string,unknown>):Incident {
  const openedAt=typeof input.openedAt==='string'?input.openedAt:new Date(0).toISOString();
  const status=incidentStatuses.includes(input.status as IncidentStatus)?input.status as IncidentStatus:'open';
  const evidence=Array.isArray(input.evidence)?input.evidence.filter((x):x is string=>typeof x==='string'):[];
  const notes=Array.isArray(input.notes)?input.notes.filter((x):x is string=>typeof x==='string'):[];
  const timeline=Array.isArray(input.timeline)&&input.timeline.length
    ? input.timeline
    : [{
        id:`timeline_${randomUUID()}`,
        at:openedAt,
        actor:'system:migration',
        role:'viewer' as Role,
        action:'incident.migrated',
        summary:'Legacy incident normalized into the versioned lifecycle schema.',
        evidence,
      }];
  return {
    schemaVersion:1,
    id:typeof input.id==='string'?input.id:`inc_${randomUUID()}`,
    title:typeof input.title==='string'?input.title:'Untitled incident',
    severity:['low','medium','high','critical'].includes(String(input.severity))?input.severity as Incident['severity']:'medium',
    status,
    openedAt,
    source:typeof input.source==='string'?input.source:'unknown',
    evidence,
    notes,
    ...(typeof input.owner==='string'&&input.owner?{owner:input.owner}:{}),
    ...(typeof input.acknowledgedAt==='string'?{acknowledgedAt:input.acknowledgedAt}:{}),
    ...(typeof input.mitigatedAt==='string'?{mitigatedAt:input.mitigatedAt}:{}),
    ...(typeof input.recoveryVerifiedAt==='string'?{recoveryVerifiedAt:input.recoveryVerifiedAt}:{}),
    ...(typeof input.resolvedAt==='string'?{resolvedAt:input.resolvedAt}:{}),
    timeline:timeline as Incident['timeline'],
    ...(input.postmortem&&typeof input.postmortem==='object'?{postmortem:input.postmortem as Incident['postmortem']}:{}),
  };
}

export class IncidentTransitionError extends Error {
  constructor(public readonly action:string,public readonly status:IncidentStatus){
    super('invalid_incident_transition');
  }
}

export class OpsStore {
  private state: OpsState = empty();
  private loaded = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(private path:string,private integrityKey:string='local-test-integrity-key-must-be-32-bytes') {
    if(integrityKey.length<32)throw new Error('monitor state integrity key must contain at least 32 characters');
  }

  private digest(state:OpsState){
    return createHmac('sha256',this.integrityKey).update(stable(state)).digest('hex');
  }

  async load() {
    if(this.loaded)return;
    let migrated=false;
    try {
      const parsed=JSON.parse(await readFile(this.path,'utf8'));
      if(parsed?.version===2&&parsed?.state&&typeof parsed?.digest==='string'){
        const expected=this.digest(parsed.state);
        if(parsed.digest.length!==expected.length||!timingSafeEqual(Buffer.from(parsed.digest),Buffer.from(expected)))throw new Error('monitor state integrity check failed');
        const incidents=(Array.isArray(parsed.state.incidents)?parsed.state.incidents:[]).map((item:Record<string,unknown>)=>normalizeIncident(item));
        migrated=stable(incidents)!==stable(parsed.state.incidents??[]);
        this.state={...empty(),...parsed.state,incidents};
      }else{
        const incidents=(Array.isArray(parsed?.incidents)?parsed.incidents:[]).map((item:Record<string,unknown>)=>normalizeIncident(item));
        this.state={...empty(),...parsed,incidents};
        migrated=true;
      }
    } catch (error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    }
    this.loaded=true;
    if(migrated)await this.persist();
  }

  snapshot(){
    return structuredClone(this.state);
  }

  async persist(){
    const content=JSON.stringify({version:2,state:this.state,digest:this.digest(this.state)},null,2);
    this.writes=this.writes.then(async()=>{
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});
      const temp=`${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp,content,{mode:0o600});
      await rename(temp,this.path);
    });
    await this.writes;
  }

  async audit(principal:Principal,action:string,target:string,outcome:string,evidence?:Record<string,unknown>){
    const item:AuditEvent={id:randomUUID(),at:new Date().toISOString(),actor:principal.username,role:principal.role,action,target,outcome,evidence};
    this.state.audits.unshift(item);
    this.state.audits=this.state.audits.slice(0,500);
    await this.persist();
    return item;
  }

  private findIncident(id:string){
    return this.state.incidents.find(incident=>incident.id===id);
  }

  private addTimeline(incident:Incident,principal:Principal,action:string,summary:string,evidence:string[]){
    incident.timeline.push({id:`timeline_${randomUUID()}`,at:new Date().toISOString(),actor:principal.username,role:principal.role,action,summary,evidence});
  }

  async createIncident(principal:Principal,input:Pick<Incident,'title'|'severity'|'source'|'evidence'>){
    const openedAt=new Date().toISOString();
    const item:Incident={
      schemaVersion:1,
      id:`inc_${randomUUID()}`,
      title:input.title,
      severity:input.severity,
      status:'open',
      openedAt,
      source:input.source,
      evidence:input.evidence,
      notes:[],
      timeline:[{
        id:`timeline_${randomUUID()}`,
        at:openedAt,
        actor:principal.username,
        role:principal.role,
        action:'incident.create',
        summary:'Incident recorded with source evidence.',
        evidence:input.evidence,
      }],
    };
    this.state.incidents.unshift(item);
    await this.audit(principal,'incident.create',item.id,'created',{source:item.source,severity:item.severity});
    return structuredClone(item);
  }

  async assignIncident(principal:Principal,id:string,owner:string,evidence:string[]){
    const incident=this.findIncident(id);
    if(!incident)return undefined;
    if(incident.owner===owner)return{incident:structuredClone(incident),changed:false};
    incident.owner=owner;
    this.addTimeline(incident,principal,'incident.assign',`Assigned incident to ${owner}.`,evidence);
    await this.audit(principal,'incident.assign',id,'assigned',{owner,evidence});
    return{incident:structuredClone(incident),changed:true};
  }

  async addIncidentNote(principal:Principal,id:string,summary:string,evidence:string[]){
    const incident=this.findIncident(id);
    if(!incident)return undefined;
    incident.notes.push(summary);
    this.addTimeline(incident,principal,'incident.note',summary,evidence);
    await this.audit(principal,'incident.note',id,'recorded',{evidence});
    return structuredClone(incident);
  }

  async transitionIncident(principal:Principal,id:string,action:IncidentAction,summary:string,evidence:string[]){
    const incident=this.findIncident(id);
    if(!incident)return undefined;
    const transitions:Record<IncidentAction,{from:IncidentStatus[];to:IncidentStatus}>={
      acknowledge:{from:['open'],to:'acknowledged'},
      investigate:{from:['acknowledged'],to:'investigating'},
      mitigate:{from:['investigating'],to:'mitigated'},
      begin_recovery:{from:['mitigated'],to:'recovery_verifying'},
      verify_recovery:{from:['recovery_verifying'],to:'resolved'},
      reopen:{from:['resolved','postmortem_complete'],to:'investigating'},
    };
    const transition=transitions[action];
    if(incident.status===transition.to)return{incident:structuredClone(incident),changed:false};
    if(!transition.from.includes(incident.status))throw new IncidentTransitionError(action,incident.status);
    if(action==='verify_recovery'&&!evidence.length)throw new Error('recovery_evidence_required');
    const from=incident.status;
    incident.status=transition.to;
    const at=new Date().toISOString();
    if(action==='acknowledge')incident.acknowledgedAt=at;
    if(action==='mitigate')incident.mitigatedAt=at;
    if(action==='verify_recovery'){
      incident.recoveryVerifiedAt=at;
      incident.resolvedAt=at;
    }
    if(action==='reopen'){
      delete incident.recoveryVerifiedAt;
      delete incident.resolvedAt;
      delete incident.postmortem;
    }
    this.addTimeline(incident,principal,`incident.${action}`,summary,evidence);
    await this.audit(principal,'incident.transition',id,'transitioned',{action,from,to:transition.to,evidence});
    return{incident:structuredClone(incident),changed:true};
  }

  async completePostmortem(principal:Principal,id:string,input:{summary:string;rootCause:string;correctiveActions:string[];evidence:string[]}){
    const incident=this.findIncident(id);
    if(!incident)return undefined;
    if(incident.status==='postmortem_complete')return{incident:structuredClone(incident),changed:false};
    if(incident.status!=='resolved')throw new IncidentTransitionError('complete_postmortem',incident.status);
    const completedAt=new Date().toISOString();
    incident.postmortem={...input,completedAt,completedBy:principal.username};
    incident.status='postmortem_complete';
    this.addTimeline(incident,principal,'incident.complete_postmortem',input.summary,input.evidence);
    await this.audit(principal,'incident.postmortem',id,'completed',{correctiveActionCount:input.correctiveActions.length,evidence:input.evidence});
    return{incident:structuredClone(incident),changed:true};
  }

  exportIncident(id:string){
    const incident=this.findIncident(id);
    return incident?structuredClone(incident):undefined;
  }

  async acknowledge(principal:Principal,id:string){
    const alert=this.state.alerts.find(alert=>alert.id===id);
    if(!alert)return undefined;
    if(alert.state==='acknowledged')return alert;
    alert.state='acknowledged';
    alert.acknowledgedBy=principal.username;
    alert.acknowledgedAt=new Date().toISOString();
    await this.audit(principal,'alert.acknowledge',id,'acknowledged',{reason:alert.reason});
    return alert;
  }

  async observeFailure(source:string,reason:string,evidenceUrl:string){
    const now=new Date().toISOString();
    const id=`upstream:${source}`;
    let alert=this.state.alerts.find(item=>item.id===id);
    if(!alert){
      alert={id,source,state:'firing',firstObservedAt:now,lastObservedAt:now,reason,evidenceUrl};
      this.state.alerts.unshift(alert);
    }else{
      alert.lastObservedAt=now;
      alert.reason=reason;
      if(alert.state==='resolved')alert.state='firing';
    }
    await this.persist();
    return alert;
  }

  async observeRecovery(source:string){
    const alert=this.state.alerts.find(item=>item.id===`upstream:${source}`);
    if(alert&&alert.state!=='resolved'){
      alert.state='resolved';
      alert.lastObservedAt=new Date().toISOString();
      await this.persist();
    }
  }

  private findBackup(id:string){
    return this.state.backupRecords.find((record):record is BackupArtifact=>
      typeof record==='object'&&record!==null&&record.schemaVersion===1&&record.id===id&&'digest' in record,
    );
  }

  private findRollback(id:string){
    return this.state.rollbackProposals.find((record):record is RollbackProposal=>
      typeof record==='object'&&record!==null&&record.schemaVersion===1&&record.id===id&&'candidateRelease' in record,
    );
  }

  private findAutomation(id:string){
    return this.state.automationProposals.find((record):record is AutomationProposal=>
      typeof record==='object'&&record!==null&&record.schemaVersion===1&&record.id===id&&'authorityBoundary' in record,
    );
  }

  async registerBackup(principal:Principal,input:Omit<BackupArtifact,'schemaVersion'|'id'|'registeredAt'|'registeredBy'|'status'|'verification'>){
    const item:BackupArtifact={
      schemaVersion:1,
      id:`backup_${randomUUID()}`,
      ...input,
      registeredAt:new Date().toISOString(),
      registeredBy:principal.username,
      status:'pending_verification',
    };
    this.state.backupRecords.unshift(item);
    await this.audit(principal,'backup.register',item.id,'pending_verification',{service:item.service,digest:item.digest,retentionUntil:item.retentionUntil});
    return structuredClone(item);
  }

  async verifyBackup(principal:Principal,id:string,input:{result:'verified'|'rejected';digestMatch:boolean;accessible:boolean;evidence:string[];notes:string}){
    const item=this.findBackup(id);
    if(!item)return undefined;
    if(item.registeredBy===principal.username)throw new Error('independent_backup_verifier_required');
    if(item.verification){
      if(item.verification.result===input.result&&item.verification.digestMatch===input.digestMatch&&item.verification.accessible===input.accessible)return{backup:structuredClone(item),changed:false};
      throw new Error('backup_verification_already_final');
    }
    if(!input.evidence.length||input.result==='verified'&&(!input.digestMatch||!input.accessible))throw new Error('backup_verification_evidence_required');
    item.verification={...input,verifiedAt:new Date().toISOString(),verifiedBy:principal.username};
    item.status=input.result;
    await this.audit(principal,'backup.verify',id,input.result,{digestMatch:input.digestMatch,accessible:input.accessible,evidence:input.evidence});
    return{backup:structuredClone(item),changed:true};
  }

  async recordRestoreDrill(principal:Principal,input:Omit<RestoreDrill,'schemaVersion'|'id'|'reportedAt'|'reportedBy'|'status'|'verification'>){
    if(!this.findBackup(input.backupId))return undefined;
    if(input.reportedResult==='passed'&&(!input.integrityVerified||!input.applicationVerified||!input.evidence.length))throw new Error('restore_pass_evidence_required');
    if(input.reportedResult==='failed'&&!input.failureReason)throw new Error('restore_failure_reason_required');
    const item:RestoreDrill={
      schemaVersion:1,
      id:`restore_${randomUUID()}`,
      ...input,
      reportedAt:new Date().toISOString(),
      reportedBy:principal.username,
      status:'pending_verification',
    };
    this.state.restoreDrills.unshift(item);
    await this.audit(principal,'restore.report',item.id,'pending_verification',{backupId:item.backupId,reportedResult:item.reportedResult,rpoObservedSeconds:item.rpoObservedSeconds,rtoObservedSeconds:item.rtoObservedSeconds});
    return structuredClone(item);
  }

  async verifyRestoreDrill(principal:Principal,id:string,input:{result:'accepted'|'rejected';evidence:string[];notes:string}){
    const item=this.state.restoreDrills.find(record=>record.id===id);
    if(!item)return undefined;
    if(item.reportedBy===principal.username)throw new Error('independent_restore_verifier_required');
    if(item.verification){
      if(item.verification.result===input.result)return{drill:structuredClone(item),changed:false};
      throw new Error('restore_verification_already_final');
    }
    const backup=this.findBackup(item.backupId);
    if(input.result==='accepted'&&backup?.status!=='verified')throw new Error('backup_not_verified');
    if(!input.evidence.length)throw new Error('restore_verification_evidence_required');
    item.verification={...input,verifiedAt:new Date().toISOString(),verifiedBy:principal.username};
    item.status=input.result==='accepted'&&item.reportedResult==='passed'?'verified_passed':'verified_failed';
    await this.audit(principal,'restore.verify',id,item.status,{backupId:item.backupId,evidence:input.evidence});
    return{drill:structuredClone(item),changed:true};
  }

  async addRollbackProposal(principal:Principal,candidateRelease:string,reason:string,previousRelease?:string,dryRunEvidence:string[]=[]){
    const proposal:RollbackProposal={
      schemaVersion:1,
      id:`rb_${randomUUID()}`,
      candidateRelease,
      ...(previousRelease?{previousRelease}:{}),
      reason,
      dryRunEvidence,
      status:'approved-not-executed',
      approvedBy:principal.username,
      approvedAt:new Date().toISOString(),
      executionBoundary:'central infrastructure owner',
    };
    this.state.rollbackProposals.unshift(proposal);
    await this.audit(principal,'rollback.propose',proposal.id,'approved-not-executed',{candidateRelease,previousRelease:previousRelease??null,dryRunEvidence});
    return structuredClone(proposal);
  }

  async verifyRollbackProposal(principal:Principal,id:string,input:{result:'verified'|'rejected';evidence:string[];notes:string}){
    const proposal=this.findRollback(id);
    if(!proposal)return undefined;
    if(proposal.approvedBy===principal.username)throw new Error('independent_rollback_verifier_required');
    if(proposal.verification){
      if(proposal.verification.result===input.result)return{proposal:structuredClone(proposal),changed:false};
      throw new Error('rollback_verification_already_final');
    }
    if(!input.evidence.length||input.result==='verified'&&(!proposal.previousRelease||!proposal.dryRunEvidence.length))throw new Error('rollback_verification_evidence_required');
    proposal.verification={...input,verifiedAt:new Date().toISOString(),verifiedBy:principal.username};
    proposal.status=input.result==='verified'?'verified-not-executed':'rejected-not-executed';
    await this.audit(principal,'rollback.verify',id,proposal.status,{candidateRelease:proposal.candidateRelease,previousRelease:proposal.previousRelease??null,evidence:input.evidence});
    return{proposal:structuredClone(proposal),changed:true};
  }

  async addAutomationProposal(principal:Principal,input:{action:'pause'|'resume';target:string;reason:string;evidence:string[];maxPauseSeconds?:number;pauseProposalId?:string}){
    if(input.action==='resume'){
      const pause=input.pauseProposalId&&this.findAutomation(input.pauseProposalId);
      if(!pause||pause.action!=='pause'||pause.target!==input.target||pause.status!=='approved-not-executed')throw new Error('approved_pause_proposal_required');
    }
    const requestedAt=new Date();
    const proposal:AutomationProposal={
      schemaVersion:1,
      id:`automation_${randomUUID()}`,
      action:input.action,
      target:input.target,
      reason:input.reason,
      evidence:input.evidence,
      requestedBy:principal.username,
      requestedAt:requestedAt.toISOString(),
      expiresAt:new Date(requestedAt.getTime()+5*60_000).toISOString(),
      ...(input.action==='pause'?{maxPauseSeconds:input.maxPauseSeconds}:{}),
      ...(input.action==='resume'?{pauseProposalId:input.pauseProposalId}:{}),
      status:'pending_review',
      executionBoundary:'central infrastructure owner',
      authorityBoundary:'pause-or-resume-only; no asset movement or authority expansion',
    };
    this.state.automationProposals.unshift(proposal);
    await this.audit(principal,'automation.propose',proposal.id,'pending_review',{action:proposal.action,target:proposal.target,expiresAt:proposal.expiresAt,maxPauseSeconds:proposal.maxPauseSeconds??null,pauseProposalId:proposal.pauseProposalId??null});
    return structuredClone(proposal);
  }

  async reviewAutomationProposal(principal:Principal,id:string,input:{decision:'approved'|'rejected';evidence:string[];notes:string}){
    const proposal=this.findAutomation(id);
    if(!proposal)return undefined;
    if(proposal.requestedBy===principal.username)throw new Error('independent_automation_reviewer_required');
    if(proposal.review)throw new Error('automation_review_already_final');
    if(Date.parse(proposal.expiresAt)<=Date.now()){
      proposal.status='expired-not-executed';
      await this.audit(principal,'automation.review',id,proposal.status,{action:proposal.action,target:proposal.target});
      throw new Error('automation_proposal_expired');
    }
    if(!input.evidence.length)throw new Error('automation_review_evidence_required');
    if(proposal.action==='resume'){
      const pause=proposal.pauseProposalId&&this.findAutomation(proposal.pauseProposalId);
      if(!pause||pause.status!=='approved-not-executed'||pause.target!==proposal.target)throw new Error('approved_pause_proposal_required');
    }
    proposal.review={...input,reviewedAt:new Date().toISOString(),reviewedBy:principal.username};
    proposal.status=input.decision==='approved'?'approved-not-executed':'rejected-not-executed';
    await this.audit(principal,'automation.review',id,proposal.status,{action:proposal.action,target:proposal.target,evidence:input.evidence,executionBoundary:proposal.executionBoundary});
    return{proposal:structuredClone(proposal),changed:true};
  }

  async addBackupRecord(principal:Principal,evidence:string){
    const item={id:`backup_${randomUUID()}`,evidence,status:'evidence-recorded',recordedAt:new Date().toISOString(),recordedBy:principal.username};
    this.state.backupRecords.unshift(item);
    await this.audit(principal,'backup.record',String(item.id),'recorded',{evidence});
    return item;
  }

  async createWalletChallenge(origin:string,accountHint?:string){
    const nonce=randomBytes(32).toString('base64url');
    const now=Date.now();
    const item:WalletChallenge={id:`wch_${randomUUID()}`,nonceHash:createHash('sha256').update(nonce).digest('hex'),accountHint,origin,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+5*60_000).toISOString()};
    this.state.walletChallenges=[item,...this.state.walletChallenges.filter(challenge=>Date.parse(challenge.expiresAt)>now-3600_000)].slice(0,100);
    await this.persist();
    return{challenge:item,nonce};
  }

  async consumeWalletChallenge(id:string,nonce:string){
    const item=this.state.walletChallenges.find(challenge=>challenge.id===id);
    if(!item||item.consumedAt||Date.parse(item.expiresAt)<Date.now())return undefined;
    const actual=createHash('sha256').update(nonce).digest('hex');
    if(actual.length!==item.nonceHash.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(item.nonceHash)))return undefined;
    item.consumedAt=new Date().toISOString();
    await this.persist();
    return structuredClone(item);
  }
}
