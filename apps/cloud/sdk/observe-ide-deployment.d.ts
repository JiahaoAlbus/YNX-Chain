import { YNXCloudClient, IDEDeploymentBinding, IDEDeploymentOperation } from './index.js';
export interface IDEDeploymentObservation {
  operation: IDEDeploymentOperation;
  logs: { requestId: string; operationLogs: IDEDeploymentOperation['logs']; runtimeLogs: string; runtimeLogSource: 'original-resource' } | null;
  observationCount: number;
}
export interface IDEDeploymentObservationOptions {
  requestId: string;
  expected: { binding: IDEDeploymentBinding; manifestSHA256: string; approvalSHA256: string; publisherId: string; resourceId: string };
  signal?: AbortSignal;
  maxObservations?: number;
  intervalMs?: number;
  timeoutMs?: number;
  until?: 'running-or-terminal' | 'terminal';
}
export declare class YNXCloudObservationError extends Error {
  operationRequestId: string;
  lastObservation: IDEDeploymentObservation | null;
  state: IDEDeploymentOperation['state'];
}
export declare function observeIDEDeployment(client: YNXCloudClient, options: IDEDeploymentObservationOptions): Promise<IDEDeploymentObservation>;
