import type {TaskStep} from './tasks';

export function needsOriginalTaskQuery(step:TaskStep):boolean {
 return ['PENDING','SENT','UNKNOWN','DISPATCHING','RECONCILING'].includes(step.status) ||
  (step.status==='COMPLETED' && step.toolStep.toolId==='ai.conversation.read' &&
   !!step.toolStep.authorityOperationId && step.toolStep.authorityReferenceState!=='COMMITTED');
}
