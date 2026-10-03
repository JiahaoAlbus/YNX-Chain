/** DOM-only controlled fixture: copies attributes/prototype, not listeners or
 * FileList. Retained detached nodes can still deliver queued native events. */
export function fileInputDOM(node,replace){
  node.files??=[];
  node.cloneNode=()=>{
    const next=Object.assign(Object.create(Object.getPrototypeOf(node)),node);
    next.value="";next.files=[];next.children=[];
    next.listeners=node.listeners instanceof Map?new Map():{};
    return fileInputDOM(next,replace);
  };
  node.replaceWith=next=>{node.isConnected=false;next.isConnected=true;replace(next)};
  return node;
}
