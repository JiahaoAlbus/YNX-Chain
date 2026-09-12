import assert from "node:assert/strict";
import test from "node:test";
import { SocialCloudAttachments, ciphertextHash, type CloudObjectRecord } from "./cloudAttachments";
import { encryptAttachment, decryptAttachment } from "./chatCrypto";

test("encrypted multipart retry skips accepted parts and decrypts exact original", async () => {
  const original = new Uint8Array(1024*1024+100).fill(71);
  const key=new Uint8Array(32).fill(3), nonce=new Uint8Array(24).fill(4);
  const metadata={key,nonce,conversationId:"group_cloud_test",name:"image.png",mimeType:"image/png"};
  const encrypted=encryptAttachment({...metadata,bytes:original});
  const record:CloudObjectRecord={objectId:`object_${"a".repeat(32)}`,uploadId:`upload_${"b".repeat(32)}`,conversationId:metadata.conversationId,totalCiphertextBytes:encrypted.ciphertext.length,sha256:encrypted.sha256};
  const parts:Record<string,{partNumber:number;bytes:number;sha256:string}>={};
  const uploaded=new Map<number,Uint8Array>();
  const requests:string[]=[];
  let failed=false,complete=false;
  const api={async request<T>(path:string,options:any):Promise<T> {
    if(path==="/social/v1/cloud-objects") {
      assert.deepEqual(options.body,{conversationId:metadata.conversationId,idempotencyKey:"attachment_test",totalCiphertextBytes:record.totalCiphertextBytes,sha256:record.sha256});
      return record as T;
    }
    return {capability:`ynx-social-object-v1.${options.body.operation}`,operation:options.body.operation,objectId:record.objectId,uploadId:options.body.operation==="object.read"?"":record.uploadId} as T;
  }};
  const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input);requests.push(`${init?.method??"GET"} ${url}`);
    assert.equal(init?.credentials,"omit");assert.equal(init?.redirect,"error");
    const authorization=new Headers(init?.headers).get("Authorization");
    assert.ok(authorization?.startsWith("Bearer ynx-social-object-v1."));
    if(url.endsWith("/uploads")||url.endsWith(record.uploadId)) return response({...record,status:complete?"complete":"uploading",partBytes:1024*1024,acceptedParts:parts});
    const number=Number(url.match(/\/parts\/(\d+)$/)?.[1]);
    if(number) {
      if(number===2&&!failed){failed=true;throw new Error("simulated connection interruption");}
      const bytes=new Uint8Array(init?.body as ArrayBuffer);
      assert.equal(new Headers(init?.headers).get("X-Ciphertext-SHA256"),ciphertextHash(bytes));
      parts[String(number)]={partNumber:number,bytes:bytes.length,sha256:ciphertextHash(bytes)};uploaded.set(number,bytes);
      return response(parts[String(number)]);
    }
    if(url.endsWith("/complete")){complete=true;return response({...record,status:"complete"});}
    const bytes=new Uint8Array(record.totalCiphertextBytes);let offset=0;
    for(const number of [...uploaded.keys()].sort()){const part=uploaded.get(number)!;bytes.set(part,offset);offset+=part.length;}
    return new Response(bytes.buffer);
  };
  const client=new SocialCloudAttachments(api,"https://cloud.example",transport);
  const created=await client.register(metadata.conversationId,"attachment_test",encrypted.ciphertext);
  await assert.rejects(client.upload(created,encrypted.ciphertext),/interruption/);
  await client.upload(created,encrypted.ciphertext);
  assert.equal(requests.filter(url=>url.endsWith("/parts/1")).length,1);
  const downloaded=await client.download(record.objectId,record.sha256,record.totalCiphertextBytes);
  assert.deepEqual(decryptAttachment({...metadata,ciphertext:downloaded}),original);
});

test("mismatched operation grant is rejected before sending ciphertext to Cloud",async()=>{
  let cloudCalls=0;
  const api={async request<T>():Promise<T>{return {capability:"ynx-social-object-v1.test",operation:"object.delete",objectId:`object_${"a".repeat(32)}`,uploadId:""} as T;}};
  const client=new SocialCloudAttachments(api,"https://cloud.example",async()=>{cloudCalls++;return new Response();});
  await assert.rejects(client.download(`object_${"a".repeat(32)}`,"a".repeat(64),10),/grant does not match/);
  assert.equal(cloudCalls,0);
});
