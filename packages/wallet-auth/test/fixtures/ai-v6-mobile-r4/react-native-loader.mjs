export async function resolve(s,c,next){if(s==='react-native')return {url:new URL('./react-native.mjs',import.meta.url).href,shortCircuit:true};return next(s,c);}
