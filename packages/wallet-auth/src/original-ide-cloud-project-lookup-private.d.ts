/** Closed immutable copy of original Native lookup DATA; never Source/Root,
 * endpoint, durable operation selection, GET header or business authority. */
export interface OriginalIDECloudRegisteredFullRefDATA {
 readonly realm:string;readonly tenant:string;readonly kind:string;readonly id:string;
 /** Canonical uint64 decimal (including zero), checked at runtime. */readonly rev:string;
}
export interface OriginalIDECloudProjectLookupDATA {
 readonly version:'YNX-IDE-CLOUD-PROJECT-LOOKUP/v1';
 readonly account:string;readonly catalogProjectId:string;
 readonly registeredCloudFullRef:OriginalIDECloudRegisteredFullRefDATA;
 readonly resourceApprovalRef:string;readonly projectRevision:string;
 readonly catalogRevision:string;readonly currentReference:string;
 /** Positive safe integer milliseconds; expires > issued. Freshness and actual
  * parent/selector/current/window bindings remain Native's responsibility. */
 readonly issuedAtMs:number;readonly expiresAtMs:number;
}
export declare function inspectOriginalIDECloudProjectLookupDATA(value:unknown):Readonly<OriginalIDECloudProjectLookupDATA>;
/** Existing PRIVATE original capture; a structural type does not authenticate
 * the native module or selection. Only lexical selectedParent supplies them. */
export declare function captureOriginalIDECloudProjectLookupPrivate(native:object,actualParent:unknown,actualWorkspaceSelection:unknown):Readonly<{owner:import('./original-ide-admission-parent-delivery.js').OriginalIDECloudLookupOwner|null;failed:boolean;error:unknown}>;
