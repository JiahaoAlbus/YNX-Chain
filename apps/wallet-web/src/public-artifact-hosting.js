const OFFICIAL_ORIGIN="https://www.ynxweb4.com";

const hex=(bytes)=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,"0")).join("");

export async function inspectOfficialArtifact(spec,fetchImpl=fetch){
  const expectedContentType=spec.expectedContentType||"application/zip";
  const record={name:spec.name,url:spec.url,expectedBytes:spec.bytes,expectedSha256:spec.sha256,expectedContentType,status:null,contentType:null,contentDisposition:null,contentLength:null,downloadedBytes:null,downloadedSha256:null,hosted:false,errorCode:null,errorMessage:null};
  try{
    if(typeof spec.name!=="string"||typeof spec.url!=="string"||!Number.isSafeInteger(spec.bytes)||spec.bytes<1||! /^[0-9a-f]{64}$/.test(spec.sha256)||! /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(expectedContentType))throw Object.assign(new Error("Artifact expectations are incomplete or malformed."),{code:"INVALID_ARTIFACT_EXPECTATION"});
    const requested=new URL(spec.url);
    if(requested.origin!==OFFICIAL_ORIGIN)throw Object.assign(new Error("Artifact URL is not on the official origin."),{code:"NON_OFFICIAL_ORIGIN"});
    const response=await fetchImpl(spec.url,{redirect:"error",signal:AbortSignal.timeout(20000)});
    record.status=response.status;record.contentType=response.headers.get("content-type");record.contentDisposition=response.headers.get("content-disposition");const lengthHeader=response.headers.get("content-length");record.contentLength=lengthHeader===null?null:Number(lengthHeader);
    const finalUrl=response.url||spec.url;
    if(finalUrl!==spec.url)throw Object.assign(new Error("Artifact response changed URL."),{code:"REDIRECTED_ARTIFACT"});
    if(response.status!==200)throw Object.assign(new Error("Artifact did not return HTTP 200."),{code:"ARTIFACT_HTTP_STATUS"});
    if(record.contentType?.split(";",1)[0].trim().toLowerCase()!==expectedContentType.toLowerCase())throw Object.assign(new Error(`Artifact is not ${expectedContentType}.`),{code:"ARTIFACT_CONTENT_TYPE"});
    if(!/^attachment(?:;|$)/iu.test(record.contentDisposition||""))throw Object.assign(new Error("Artifact is not an attachment."),{code:"ARTIFACT_DISPOSITION"});
    if(record.contentLength!==spec.bytes)throw Object.assign(new Error("Artifact Content-Length is not exact."),{code:"ARTIFACT_CONTENT_LENGTH"});
    const body=await response.arrayBuffer();record.downloadedBytes=body.byteLength;record.downloadedSha256=hex(await crypto.subtle.digest("SHA-256",body));
    if(record.downloadedBytes!==spec.bytes)throw Object.assign(new Error("Downloaded artifact byte count is not exact."),{code:"ARTIFACT_BYTES"});
    if(record.downloadedSha256!==spec.sha256)throw Object.assign(new Error("Downloaded artifact SHA-256 is not exact."),{code:"ARTIFACT_SHA256"});
    record.hosted=true;
  }catch(error){record.errorCode=error?.code||error?.name||"ARTIFACT_UNAVAILABLE";record.errorMessage=error?.message||String(error);}
  return Object.freeze(record);
}
