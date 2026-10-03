import {ContextChangedError} from './request-context.js';
// Opening the same DOM form again creates a different presentation. A cancelled
// form cannot dispatch after proof preparation or adopt a late result.
export function createFormContexts(){
 const presentations=new WeakMap(),bound=new WeakSet();
 const reset=dialog=>{presentations.delete(dialog);for(const form of dialog.querySelectorAll('form'))form.reset();};
 function bind(dialog){if(bound.has(dialog))return;bound.add(dialog);dialog.addEventListener('cancel',()=>reset(dialog));dialog.addEventListener('close',()=>{if(!dialog.open)reset(dialog)});}
 return Object.freeze({
  open(dialog){bind(dialog);presentations.set(dialog,Symbol());dialog.showModal();},
  close(dialog){reset(dialog);dialog.close();},
  capture(form,assertWorkspace){const dialog=form.closest('dialog'),presentation=dialog&&presentations.get(dialog);if(!dialog||!dialog.open||!presentation)throw new ContextChangedError();return()=>{assertWorkspace();if(!dialog.open||presentations.get(dialog)!==presentation)throw new ContextChangedError();};}
 });
}
