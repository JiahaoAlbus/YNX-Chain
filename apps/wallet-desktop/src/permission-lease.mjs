const revoked = () => Object.assign(Error("The DApp account permission was revoked. Review the request again."), {code:4100,data:{code:"ACCOUNT_PERMISSION_REVOKED"}});

// Process-local cancellation, not authenticated storage or cross-process CAS.
export class PermissionEpoch {
  #all = 0; #pendingAll = 0; #origins = new Map();
  #beforeRevoke=new Set();
  addBeforeRevoke(listener){if(typeof listener!=='function')throw Error('Invalid retirement listener');this.#beforeRevoke.add(listener);return()=>this.#beforeRevoke.delete(listener);}
  #state(origin) {
    if (!this.#origins.has(origin)) {
      if (this.#origins.size >= 2048) { this.#all++; this.#origins.clear(); }
      this.#origins.set(origin, {revision:0,pending:0});
    }
    return this.#origins.get(origin);
  }
  lease(origin) {
    const state = this.#state(origin), revision = state.revision, all = this.#all;
    const assert = () => {if(this.#all !== all || this.#origins.get(origin) !== state || state.revision !== revision || state.pending || this.#pendingAll) throw revoked();};
    assert(); return Object.freeze({assert});
  }
  async revoke(origin, action) {
    const state = origin === null ? null : this.#state(origin);
    let failed=false,cause,result;for(const listener of this.#beforeRevoke)try{if(listener(origin)!==undefined)throw Error('Invalid retirement result');}catch(e){if(!failed){failed=true;cause=e;}}
    this.#pendingAll++;
    if(state) {state.revision++;state.pending++;} else this.#all++;
    try {result=await action();}catch(e){if(!failed){failed=true;cause=e;}}
    finally {if(state)state.pending--;this.#pendingAll--;}
    if(failed)throw cause;return result;
  }
}

export function bindPermissionGuard(guard, permission) {
  if (!permission) return guard;
  const assert = () => {permission.assert();guard?.assert();};
  const bound = {
    ...guard, assert,
    step: async action => {
      const checked = async () => {permission.assert();const value=await action();permission.assert();return value;};
      if(guard?.step) {permission.assert();return guard.step(checked);}
      assert();return checked();
    },
  };
  for(const effect of ["submit","deliver"]) if(guard?.[effect]) bound[effect] = action => {assert();return guard[effect](() => {permission.assert();return action();});};
  return Object.freeze(bound);
}
