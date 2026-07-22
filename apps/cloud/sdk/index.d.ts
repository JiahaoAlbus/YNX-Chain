export type Product = "cloud" | "docs";
export type ObjectKind = "file" | "folder" | "doc";
export interface CloudObject { id: string; product: Product; owner: string; parentId?: string; kind: ObjectKind; name: string; mime?: string; size: number; hash?: string; version: number; starred: boolean; trashedAt?: string; createdAt: string; updatedAt: string }
export interface ObjectPage { items: CloudObject[]; nextCursor?: string; limit: number; scanned: number }
export interface ClientOptions { endpoint: string; product: Product; getAccessToken: () => string | Promise<string>; fetch?: typeof fetch; maxRetries?: number }
export interface RequestOptions { method?: string; body?: unknown; headers?: HeadersInit; signal?: AbortSignal; response?: "json" | "response" | "bytes" | "text"; retry?: number }
export declare class YNXCloudError extends Error { status: number; requestId: string; errorId: string; retryAfter: number }
export declare class YNXCloudClient {
  constructor(options: ClientOptions);
  readonly endpoint: string; readonly product: Product;
  request(path: string, options?: RequestOptions): Promise<any>;
  list(options?: Record<string, string | number | boolean | undefined>): Promise<ObjectPage>;
  getObject(id: string): Promise<CloudObject>; createObject(input: unknown): Promise<CloudObject>; deleteObject(id: string): Promise<unknown>;
  content(id: string, options?: { range?: string; signal?: AbortSignal }): Promise<Response>;
  versions(id: string): Promise<unknown[]>; restoreVersion(id: string, version: number): Promise<CloudObject>; saveDocument(id: string, input: unknown): Promise<CloudObject>;
  star(id: string, starred: boolean): Promise<CloudObject>; trash(id: string): Promise<CloudObject>; restore(id: string): Promise<CloudObject>;
  quota(): Promise<{ usedBytes: number; limitBytes: number; claim: string }>; audit(): Promise<unknown[]>; exportData(): Promise<Response>;
  deletionRecords(): Promise<unknown[]>; retryDeletion(id: string): Promise<unknown>;
  initiateMultipart(input: unknown): Promise<unknown>; multipartStatus(id: string): Promise<unknown>; putMultipartPart(id: string, part: number, bytes: ArrayBuffer | ArrayBufferView, sha256: string): Promise<unknown>; completeMultipart(id: string, parts: number[]): Promise<CloudObject>; cancelMultipart(id: string): Promise<unknown>;
  initiateDirectUpload(input: unknown): Promise<unknown>; directUploadStatus(id: string): Promise<unknown>; completeDirectUpload(id: string): Promise<CloudObject>; cancelDirectUpload(id: string): Promise<unknown>;
  createAIJob(input: unknown): Promise<unknown>; getAIJob(id: string): Promise<unknown>; cancelAIJob(id: string): Promise<unknown>; reviewAIJob(id: string, decision: "applied" | "rejected"): Promise<unknown>;
}
