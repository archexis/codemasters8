import {getSessionUser} from './repository';
const key=(view:string)=>`saq-view:${getSessionUser()??'demo'}:${view}`;
export function readViewState<T>(view:string,fallback:T):T {
  try {const value=JSON.parse(sessionStorage.getItem(key(view))??'null');return value&&typeof value==='object'?{...fallback,...value}:fallback;}catch{return fallback;}
}
export function writeViewState(view:string,value:unknown){try{sessionStorage.setItem(key(view),JSON.stringify(value));}catch{/* View persistence does not block work. */}}
