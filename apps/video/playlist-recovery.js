// Both real product entry points use this exact persisted body/key and readback.
export async function createRecoveredPlaylist({journal,account,current,api,name}) {
  current();const original=await journal.begin(account,name,current);current();
  const created=await api('/v1/playlists',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':original.key},body:JSON.stringify(original.body)});current();
  if(!created||typeof created.ID!=='string'||!/^pl_[A-Za-z0-9_-]+$/.test(created.ID)||created.Owner!==account||created.Name!==original.body.Name)throw Error('Original playlist owner readback required. Retry the saved request.');
  const rows=await api('/v1/playlists');current();
  if(!Array.isArray(rows)||!rows.some(row=>row.ID===created.ID&&row.Owner===account&&row.Name===original.body.Name))throw Error('Original playlist readback unavailable. Retry the saved request.');
  await journal.finish(account,original,current);current();return created;
}
