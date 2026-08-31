export declare const CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION:1;
export declare const CANONICAL_GATEWAY_BACKUP_ALGORITHM:"aes-256-gcm";

export type CanonicalGatewayBackupSummary=Readonly<{
  algorithm:"aes-256-gcm";
  backupBytes:number;
  backupSha256:string;
  createdAt:string;
  schemaVersion:1;
  sourceStateDigest:string;
  stateSchemaVersion:1;
}>;

export type CanonicalGatewayBackupPolicy=Readonly<{
  maxAgeMs?:number;
  minimumCreatedAt?:string;
  now?:()=>Date;
}>;

export declare function decodeGatewayBackupKey(value:string):Uint8Array;
export declare function createGatewayStateBackup(options:Readonly<{
  backupPath:string;
  key:Uint8Array;
  statePath:string;
  now?:()=>Date;
}>):CanonicalGatewayBackupSummary;
export declare function verifyGatewayStateBackup(options:Readonly<{
  backupPath:string;
  key:Uint8Array;
}>&CanonicalGatewayBackupPolicy):CanonicalGatewayBackupSummary&Readonly<{verified:true}>;
export declare function restoreGatewayStateBackup(options:Readonly<{
  backupPath:string;
  key:Uint8Array;
  statePath:string;
}>&CanonicalGatewayBackupPolicy):CanonicalGatewayBackupSummary&Readonly<{restored:true;restoredStateDigest:string}>;
export declare function readGatewayStateEnvelope(path:string):Readonly<{schemaVersion:1;snapshot:unknown;stateDigest:string}>;
