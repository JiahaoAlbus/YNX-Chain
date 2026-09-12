import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SocialAPI } from "./api";

export type CloudObjectRecord = { objectId: string; uploadId: string; conversationId: string; totalCiphertextBytes: number; sha256: string };
type UploadStatus = CloudObjectRecord & {status: string; partBytes: number; acceptedParts: Record<string,{partNumber:number;bytes:number;sha256:string}>};
const limit = 25 * 1024 * 1024, partBytes = 1024 * 1024;
export const ciphertextHash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

export class SocialCloudAttachments {
  private readonly base: string;
  constructor(private readonly api: Pick<SocialAPI,"request">, base: string, private readonly transport: typeof fetch = fetch) {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Configure the approved HTTPS Cloud attachment origin.");
    this.base = url.origin + "/api/v1/social-attachments";
  }
  register(conversationId: string, idempotencyKey: string, ciphertext: Uint8Array) {
    this.validateBytes(ciphertext);
    return this.api.request<CloudObjectRecord>("/social/v1/cloud-objects", {method:"POST",body:{conversationId,idempotencyKey,totalCiphertextBytes:ciphertext.length,sha256:ciphertextHash(ciphertext)}});
  }
  private validateBytes(bytes: Uint8Array) {
    if (bytes.length < 1 || bytes.length > limit) throw new Error("Ciphertext exceeds the 25 MB attachment limit.");
  }
  private async request(record: Pick<CloudObjectRecord,"objectId"|"uploadId">, operation: string, path: string, init: RequestInit = {}) {
    if (!/^object_[a-f0-9]{32}$/.test(record.objectId)) throw new Error("Invalid Cloud attachment object identity.");
    const grant = await this.api.request<{capability:string;operation:string;objectId:string;uploadId:string}>(`/social/v1/cloud-objects/${record.objectId}/capability`,{method:"POST",body:{operation}});
    if (!grant.capability?.startsWith("ynx-social-object-v1.") || grant.operation !== operation || grant.objectId !== record.objectId || grant.uploadId !== (operation === "object.read" ? "" : record.uploadId)) throw new Error("Cloud attachment grant does not match this operation.");
    const response = await this.transport(this.base + path, {...init, credentials:"omit",redirect:"error",cache:"no-store",headers:{...init.headers,Authorization:`Bearer ${grant.capability}`}});
    if (!response.ok) throw new Error(`Cloud attachment ${operation} failed (${response.status}). Retry the same attachment.`);
    return response;
  }
  async upload(record: CloudObjectRecord, ciphertext: Uint8Array, progress: (sent:number,total:number)=>void = ()=>{}) {
    this.validateBytes(ciphertext);
    if (record.totalCiphertextBytes !== ciphertext.length || record.sha256 !== ciphertextHash(ciphertext) || !/^upload_[a-f0-9]{32}$/.test(record.uploadId)) throw new Error("Pending attachment does not match its immutable Cloud record.");
    await this.request(record,"upload.create","/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(record)});
    const status = await (await this.request(record,"upload.status",`/uploads/${record.uploadId}`)).json() as UploadStatus;
    for (const key of ["objectId","uploadId","conversationId","totalCiphertextBytes","sha256"] as const) if(status[key] !== record[key]) throw new Error("Cloud upload status binding mismatch.");
    if (status.partBytes !== partBytes || !status.acceptedParts || !["uploading","complete"].includes(status.status)) throw new Error("Cloud upload is not resumable.");
    if (status.status !== "complete") {
      for (let offset=0, number=1; offset<ciphertext.length; offset+=partBytes,number++) {
        const part=ciphertext.subarray(offset,Math.min(offset+partBytes,ciphertext.length));
        const digest=ciphertextHash(part), accepted=status.acceptedParts[String(number)];
        if (accepted && (accepted.partNumber!==number || accepted.bytes!==part.length || accepted.sha256!==digest)) throw new Error("Previously uploaded part differs from the retained ciphertext.");
        if (!accepted) await this.request(record,"upload.part",`/uploads/${record.uploadId}/parts/${number}`,{method:"PUT",headers:{"Content-Type":"application/octet-stream","X-Ciphertext-SHA256":digest},body:Uint8Array.from(part).buffer});
        progress(offset+part.length,ciphertext.length);
      }
    }
    const completed=await (await this.request(record,"upload.complete",`/uploads/${record.uploadId}/complete`,{method:"POST"})).json() as UploadStatus;
    for(const key of ["objectId","uploadId","conversationId","totalCiphertextBytes","sha256"] as const) if(completed[key]!==record[key])throw new Error("Completed attachment binding mismatch.");
    if(completed.status!=="complete")throw new Error("Cloud did not confirm attachment completion.");
  }
  async download(objectId:string, expectedHash:string, expectedBytes:number) {
    if(!/^[a-f0-9]{64}$/.test(expectedHash)||!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>limit)throw new Error("Invalid signed attachment digest or size.");
    const response=await this.request({objectId,uploadId:""},"object.read",`/objects/${objectId}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==expectedBytes||ciphertextHash(bytes)!==expectedHash)throw new Error("Downloaded attachment differs from the signed ciphertext metadata.");
    return bytes;
  }
}
