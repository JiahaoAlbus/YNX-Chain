import {backupCardDatabase} from './backup.ts';

const [source,directory,...extra]=process.argv.slice(2);
if(!source||!directory||extra.length){
  console.error('Usage: node server/backup-main.ts /var/lib/ynx-card/card.sqlite EXISTING_PRIVATE_BACKUP_DIRECTORY');
  process.exitCode=2;
}else{
  backupCardDatabase(source,directory).then(receipt=>console.log(JSON.stringify(receipt,null,2))).catch(()=>{
    console.error('Card backup failed. No completed receipt should be accepted; preserve partial output for investigation.');
    process.exitCode=1;
  });
}
