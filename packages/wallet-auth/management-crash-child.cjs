const {DatabaseSync}=require('node:sqlite');
process.once('message',async ({moduleURL,path,args,stopAt,when})=>{
 try{
  const {openOriginalTaskGrantClockStore}=await import(moduleURL);
  const store=openOriginalTaskGrantClockStore({path,namespace:'test',enableCandidateManagementBindings:true},{readOriginalClockAtStoreFence:()=>5,assertCurrentAtStoreFence:()=>undefined});
  const exec=DatabaseSync.prototype.exec;let commits=0;
  DatabaseSync.prototype.exec=function(sql){
   if(sql==='COMMIT'){
    commits++;
    if(commits===stopAt&&when==='before'){process.send({checkpoint:'reached'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}
    const result=exec.call(this,sql);
    if(commits===stopAt&&when==='after'){process.send({checkpoint:'reached'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}
    return result;
   }
   return exec.call(this,sql);
  };
  store.commitManagementOriginal(args);
  process.send({unexpected:'returned'});
 }catch(e){process.send({unexpected:e.message})}
});
