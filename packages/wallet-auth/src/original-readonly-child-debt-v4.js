// Package-private cleanup state, NOT an authority/provider/Root constructor.
// A failed join never licenses close; a failed close is never replayed.
export class OriginalReadOnlyChildDebtV4{
 #child;#retireSelected=false;#joined=false;#closeSelected=false;#closed=false;#first;#closeFailure;#flight;
 constructor(originalChild){this.#child=originalChild}
 get closed(){return this.#closed}
 get firstCausePresent(){return!!this.#first}
 get firstCause(){return this.#first?.cause}
 #remember(cause){this.#first??={cause}}
 drain(){if(this.#flight)return this.#flight;const work=Promise.resolve().then(()=>this.#run());this.#flight=work;work.then(()=>{this.#flight=undefined},()=>{this.#flight=undefined});return work}
 async #run(){if(this.#closed)return;let first;
  if(!this.#retireSelected){this.#retireSelected=true;try{await this.#child?.retire?.()}catch(cause){this.#remember(cause);first={cause}}}
  if(!this.#joined){try{if(await this.#child?.join?.()!==undefined)throw Error('PAIR_V4_READONLY_JOIN_NOT_COMPLETE');this.#joined=true}catch(cause){this.#remember(cause);throw(first??{cause}).cause}}
  if(!this.#closeSelected){this.#closeSelected=true;try{if(await this.#child?.close?.()!==undefined)throw Error('PAIR_V4_READONLY_CLOSE_NOT_COMPLETE');this.#closed=true}catch(cause){this.#remember(cause);this.#closeFailure={cause};throw(first??{cause}).cause}}
  else if(!this.#closed){if(typeof this.#child?.drainPartial!=='function')throw this.#closeFailure?.cause;try{if(await this.#child.drainPartial()!==undefined)throw Error('PAIR_V4_READONLY_DRAIN_NOT_COMPLETE');this.#closed=true}catch(cause){this.#remember(cause);throw cause}}
  if(first)throw first.cause;
 }
 status(){return Object.freeze({retireSelected:this.#retireSelected,joined:this.#joined,closeSelected:this.#closeSelected,closed:this.#closed,firstCausePresent:!!this.#first,firstCause:this.#first?.cause})}
}
