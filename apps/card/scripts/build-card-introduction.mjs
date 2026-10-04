import {mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function buildCardIntroduction({root,output}){
  const destination=join(output,'about');await mkdir(destination,{recursive:true});
  for(const file of ['index.html','about.css','about.mjs'])await copyFile(join(root,'public/about',file),join(destination,file));
  for(const file of ['ynx-logo.png','card-testnet-identity.svg'])await copyFile(join(root,'assets',file),join(destination,file));
}
