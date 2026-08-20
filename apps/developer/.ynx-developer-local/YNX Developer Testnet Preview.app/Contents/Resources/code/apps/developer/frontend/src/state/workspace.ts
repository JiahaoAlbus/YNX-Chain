export type ProjectState = { id:string; name:string; revision:number; remoteRevision:number; files:Record<string,string>; folders:string[]; open:string[]; active:string };
const KEY="ynx-code-project-v1";
const initial:ProjectState={id:crypto.randomUUID(),name:"YNX C++ Starter",revision:1,remoteRevision:0,open:["src/main.cpp"],active:"src/main.cpp",folders:["src"],files:{"src/main.cpp":"#include <iostream>\n\nint main() {\n  std::cout << \"Hello from YNX Code\" << std::endl;\n  return 0;\n}\n","README.md":"# YNX C++ Starter\n\nRun the active C++ file through an isolated YNX Code workspace runtime.\n"}};

export function loadProject():ProjectState { try { const value=JSON.parse(localStorage.getItem(KEY)||""); if(value&&value.files&&value.active)return {...value,remoteRevision:Number.isInteger(value.remoteRevision)?value.remoteRevision:0,folders:Array.isArray(value.folders)?value.folders:foldersFromFiles(Object.keys(value.files))}; } catch {} return initial; }
export function saveProject(project:ProjectState){localStorage.setItem(KEY,JSON.stringify(project));}
export function validPath(path:string){return path.length>0&&path.length<=240&&!path.startsWith("/")&&!path.includes("..")&&/^[A-Za-z0-9_./ +@-]+$/.test(path)&&!path.split("/").some(part=>!part||part===".");}
export function foldersFromFiles(paths:string[]){const folders=new Set<string>();for(const path of paths){const parts=path.split("/").slice(0,-1);for(let index=1;index<=parts.length;index++)folders.add(parts.slice(0,index).join("/"));}return [...folders].sort();}
