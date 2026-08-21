import "@testing-library/jest-dom/vitest";

if (!globalThis.localStorage) {
  const values = new Map<string,string>();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{get length(){return values.size},clear:()=>values.clear(),getItem:(key:string)=>values.get(key)??null,key:(index:number)=>Array.from(values.keys())[index]??null,removeItem:(key:string)=>values.delete(key),setItem:(key:string,value:string)=>values.set(String(key),String(value))}});
}
