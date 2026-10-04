// Both real product entry points use this exact persisted body/key and readback.
export async function createRecoveredPlaylist({journal,account,current,api,name}) {
  current();const original=await journal.begin(account,name,current);current();
  const created=await api('/v1/playlists',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':original.key},body:JSON.stringify(original.body)});current();
  if(!created||typeof created.ID!=='string'||!/^pl_[A-Za-z0-9_-]+$/.test(created.ID)||created.Owner!==account||created.Name!==original.body.Name)throw Error('Original playlist owner readback required. Retry the saved request.');
  const rows=await api('/v1/playlists');current();
  if(!Array.isArray(rows)||!rows.some(row=>row.ID===created.ID&&row.Owner===account&&row.Name===original.body.Name))throw Error('Original playlist readback unavailable. Retry the saved request.');
  await journal.finish(account,original,current);current();return created;
}

// A read proving the requested final state can confirm an admitted old request
// without reissuing DELETE against an already absent list or membership.
export async function recoverPlaylistOperation({journal,account,current,api,action,playlistID,videoID=null}) {
  current();if(!['add','remove','delete'].includes(action)||!/^pl_[A-Za-z0-9_-]+$/.test(playlistID)||action!=='delete'&&!/^vid_[A-Za-z0-9_-]+$/.test(videoID))throw Error('Original playlist change required.');
  const read=async()=>{const rows=await api('/v1/playlists');current();if(!Array.isArray(rows)||rows.some(row=>!row||row.Owner!==account||typeof row.ID!=='string'||typeof row.Name!=='string'||!/^pl_[A-Za-z0-9_-]+$/.test(row.ID)||row.VideoIDs!==null&&row.VideoIDs!==undefined&&(!Array.isArray(row.VideoIDs)||row.VideoIDs.some(id=>typeof id!=='string'||!/^vid_[A-Za-z0-9_-]+$/.test(id)))))throw Error('Original account playlist readback required.');if(new Set(rows.map(row=>row.ID)).size!==rows.length)throw Error('Ambiguous original playlist readback.');return rows;};
  const same=row=>row&&row.body.action===action&&row.body.playlistID===playlistID&&row.body.videoID===(action==='delete'?null:videoID);
  const saved=await journal.read(account,current);current();if(saved.pending&&!same(saved.pending))throw Error('Retry the original playlist change before starting another.');
  const known=saved.pending??saved.history.find(same),before=await read(),target=before.find(row=>row.ID===playlistID);
  if(!known&&!target)throw Error('Original owned playlist unavailable.');
  const original=await journal.begin(account,known?.body??{action,playlistID,videoID:action==='delete'?null:videoID,name:target.Name},current);current();
  const done=rows=>{const row=rows.find(item=>item.ID===original.body.playlistID);return original.body.action==='delete'?!row:!!row&&((row.VideoIDs??[]).includes(original.body.videoID)===(original.body.action==='add'));};
  if(!done(before)){
    const path='/v1/playlists/'+encodeURIComponent(original.body.playlistID)+(original.body.action==='delete'?'':'/videos'+(original.body.action==='remove'?'/'+encodeURIComponent(original.body.videoID):''));
    const reply=await api(path,{method:original.body.action==='add'?'POST':'DELETE',headers:{'Content-Type':'application/json','Idempotency-Key':original.key},...(original.body.action==='add'?{body:JSON.stringify({video_id:original.body.videoID})}:{})});current();
    if(!reply||reply.ok!==true||Object.keys(reply).length!==1)throw Error('Original playlist change reply unavailable. Retry the saved request.');
    if(!done(await read()))throw Error('Original playlist change readback unavailable. Retry the saved request.');
  }
  await journal.finish(account,original,current);current();return original;
}
