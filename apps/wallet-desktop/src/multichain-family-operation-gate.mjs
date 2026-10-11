import {multiError} from './multichain-config.mjs';
/** Shared trusted-main fence for network edits and new transaction producers.
 * No queue/replay: the caller must explicitly try again after the live action.
 */
export class FamilyOperationGate {
  #busy=false;
  async run(action){if(this.#busy)throw multiError('MULTICHAIN_BUSY','Finish the current chain operation first.');this.#busy=true;try{return await action();}finally{this.#busy=false;}}
}
