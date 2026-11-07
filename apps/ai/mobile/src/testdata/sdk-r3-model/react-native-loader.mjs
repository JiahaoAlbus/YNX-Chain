// PUBLIC test seam only; never used by production or Metro graph.
export async function resolve(specifier,context,nextResolve){if(specifier==='react-native')return {url:new URL('./react-native.mjs',import.meta.url).href,shortCircuit:true};return nextResolve(specifier,context);}
