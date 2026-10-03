const revoked = () => Object.assign(Error("The DApp account permission was revoked. Review the request again."), {code:4100,data:{code:"ACCOUNT_PERMISSION_REVOKED"}});

// Process-local cancellation, not authenticated storage or cross-process CAS.
export class PermissionEpoch {
  #all = 0; #pendingAll = 0; #origins = new Map();
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
    this.#pendingAll++;
    if(state) {state.revision++;state.pending++;} else this.#all++;
    try {return await action();}
    finally {if(state)state.pending--;this.#pendingAll--;}
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
