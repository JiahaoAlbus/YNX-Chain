/** UI-only single-flight ownership. Never grants a signing/session lease.
 * Closing invalidates both queued handlers and completions; reopening cannot
 * let an old completion release a new action. */
export class ModalActionGate {
  private active=true;
  private current:object|null=null;
  open(){this.active=true;this.current=null}
  close(){this.active=false;this.current=null}
  acquire():Readonly<{isCurrent:()=>boolean;finish:()=>boolean}>|null {
    if(!this.active||this.current)return null;
    const token={};this.current=token;
    const isCurrent=()=>this.active&&this.current===token;
    return Object.freeze({isCurrent,finish:()=>{if(!isCurrent())return false;this.current=null;return true}});
  }
}
