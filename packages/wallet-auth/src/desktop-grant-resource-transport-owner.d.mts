/** Package-private custody DATA only; not a Source/Root constructor or grant. */
export interface OriginalTaskResourceCleanupDATA {
 readonly physicalDone: boolean;
 readonly errorPresent: boolean;
 readonly error?: unknown;
 readonly sourceFirstPresent?: boolean;
 readonly sourceFirst?: unknown;
 readonly transportFirstPresent?: boolean;
 readonly transportFirst?: unknown;
}
export interface OriginalTaskResourceTransportOwner {
 assertCurrent(): void;
 retire(): void;
 join(): Promise<OriginalTaskResourceCleanupDATA>;
 close(): Promise<OriginalTaskResourceCleanupDATA>;
 isJoined(): boolean;
 isClosed(): boolean;
 firstCause(): OriginalTaskResourceCleanupDATA;
 lifetime(): Readonly<{retired:boolean;joined:boolean;closed:boolean;responseHeld:boolean;transport:unknown}>;
}
/** Existing Source/input contract remains undefined-only success. On a paired
 * cleanup error it throws the original cause (including 0/null), AFTER storing
 * the actual isJoined/isClosed witness. No exception DTO controls physicalDone. */
export interface OriginalTaskResourceInputOwner {
 assertCurrent(): void;
 retire(): void;
 join(): Promise<void>;
 close(): Promise<void>;
 isJoined(): boolean;
 isClosed(): boolean;
 firstCause(): OriginalTaskResourceCleanupDATA;
}
export declare function openOriginalTaskReadTransport(
 actualNativeRoot: Readonly<{assertNativeCurrent():void}>,
 originalRootSelectedProfile: unknown,
 originalRootSelectedModulePath: string,
 id: 'input'|'execute'|'query',
 wire: Uint8Array,
 options?: Readonly<{signal:AbortSignal|undefined}>
): Promise<Readonly<{owner:OriginalTaskResourceTransportOwner;errorPresent:boolean;error?:unknown;sourceCurrentErrorPresent:boolean;sourceCurrentError?:unknown;data:unknown}>>;
