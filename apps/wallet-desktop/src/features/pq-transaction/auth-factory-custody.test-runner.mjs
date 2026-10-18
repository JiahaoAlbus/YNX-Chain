import {registerHooks} from 'node:module';
import {registerPQAuthFactoryCustodyTests} from './auth-factory-custody.test-body.mjs';
import {createPUBLICPeer,brandPUBLICBorrow} from './auth-factory-custody.fixture.mjs';

export async function registerActualPQAuthFactoryCustodyTests(factoryURL){
  // Isolate only this test copy of the actual factory module. Never redirect
  // other tests' authority/Electron imports, or production imports.
  const selected=new URL(factoryURL);selected.searchParams.set('PUBLIC-pq-custody-test','1');
  const fixture=new URL('./auth-factory-custody.fixture.mjs',import.meta.url).href;
  registerHooks({resolve(specifier,context,next){
    if(context.parentURL===selected.href&&(specifier==='electron'||specifier==='../desktop-wallet-authority.mjs'))return {url:fixture,shortCircuit:true};
    return next(specifier,context);
  }});
  const auth=await import(selected.href);
  registerPQAuthFactoryCustodyTests({auth,createPUBLICPeer,brandPUBLICBorrow,expectedURL:new URL('../index.html',factoryURL).href});
}
