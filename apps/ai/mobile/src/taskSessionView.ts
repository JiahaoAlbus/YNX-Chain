// A React effect runs after a render. Never expose the previous owner's task
// state during the render in which the session is removed or replaced.
export function sessionOwnedValue<T>(current:object|undefined, owner:object|undefined, value:T|null):T|null {
 return current && current===owner ? value : null;
}
