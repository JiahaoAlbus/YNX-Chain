import { Workbench } from './Workbench';
import { WorkspaceRecoveryGate } from './WorkspaceRecoveryGate';

// Keep the compatibility editor outside the primary native-workbench entry.
// Loading it must retain the existing recovery gate and stored project.
export default function GuestWorkspace() {
  return <WorkspaceRecoveryGate><Workbench /></WorkspaceRecoveryGate>;
}
