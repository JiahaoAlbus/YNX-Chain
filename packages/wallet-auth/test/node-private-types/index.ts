import type {OriginalIDEParentHost} from '../../src/original-ide-parent-host.js';
declare const host:OriginalIDEParentHost;
const original:Buffer=host.readInstalledFrame();
host.acknowledge(original.subarray(0));
void original;
