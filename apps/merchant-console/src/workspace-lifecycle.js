// Product navigation ends a presentation, not the Wallet or merchant authority.
// Opaque mutation identities and in-memory form drafts remain recoverable.
export function createWorkspaceLifecycle({session,requests,viewAllowed,render}){
 const end=()=>{requests.invalidate();session.busy=false;session.oneTime=null;session.invoiceReview=null;session.error='';session.notice='';};
 return Object.freeze({navigate(view){if(view===session.view||!viewAllowed(view))return false;end();session.view=view;render();return true;},suspend(){if(!session.token)return false;end();render();return true;}});
}
