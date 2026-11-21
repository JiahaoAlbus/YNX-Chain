// Presentation lifetime only. It carries no credential or authorization.
export class ChatScope<S extends object>{
 private session:S|null=null;private conversation:string|null=null;private revision=0;private listRevision=0;
 setSession(session:S|null){if(this.session===session)return false;this.session=session;this.conversation=null;this.revision++;this.listRevision++;return true}
 select(session:S,id:string|null){if(this.session!==session)return false;if(this.conversation===id)return false;this.conversation=id;this.revision++;this.listRevision++;return true}
 capture(session:S,id:string|null){return {session,id,revision:this.revision}}
 current(token:{session:S;id:string|null;revision:number}){return this.session===token.session&&this.conversation===token.id&&this.revision===token.revision}
 captureList(session:S){return {session,revision:this.revision,list:this.session===session?++this.listRevision:-1}}
 currentList(token:{session:S;revision:number;list:number}){return this.session===token.session&&this.revision===token.revision&&this.listRevision===token.list}
 ownsSession(session:S){return this.session===session}
 signedOut(){return this.session===null}
 owner(){return this.session}
 selected(){return this.conversation}
}

export class ChatDrafts<S extends object>{
 private drafts=new WeakMap<S,Map<string,string>>();
 put(session:S,conversation:string,value:string){let entries=this.drafts.get(session);if(!entries){entries=new Map();this.drafts.set(session,entries)}entries.set(conversation,value)}
 get(session:S,conversation:string){return this.drafts.get(session)?.get(conversation)??''}
}

export function guardChatCallbacks<T>(current:()=>boolean, callbacks:{onMetadata:(value:unknown)=>void;onToken:(text:string)=>void;onDone:(value:T)=>void;onError:(error:Error)=>void}){
 return {onMetadata:(value:unknown)=>{if(current())callbacks.onMetadata(value)},onToken:(text:string)=>{if(current())callbacks.onToken(text)},onDone:(value:T)=>{if(current())callbacks.onDone(value)},onError:(error:Error)=>{if(current())callbacks.onError(error)}};
}
