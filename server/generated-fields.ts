import type { GeneratedFields } from './ai-service.ts';

export function parseGeneratedFields(text:string):GeneratedFields {
  let value:unknown;
  try { value=JSON.parse(text); } catch { throw new Error('Provider response must be a raw JSON object matching the indicator schema.'); }
  if (!record(value) || !exactKeys(value,['name','description','code','parameters','assumptions'])) throw new Error('Provider response does not match the indicator schema.');
  boundedString(value.name,'name',120,true);boundedString(value.description,'description',2000,false);boundedString(value.code,'code',32_000,true);
  if (new TextEncoder().encode(value.code).byteLength>64_000) throw new Error('Indicator code exceeds the byte limit.');
  if (!Array.isArray(value.parameters)||value.parameters.length>30) throw new Error('Indicator parameters are invalid.');
  for(const [i,p] of value.parameters.entries()) {
    if (!record(p)||!exactKeys(p,['key','label','type','default','min','max','step'])) throw new Error(`Parameter ${i} does not match the schema.`);
    boundedString(p.key,`parameter ${i} key`,100,true);boundedString(p.label,`parameter ${i} label`,120,true);
    if(p.type!=='number'||![p.default,p.min,p.max,p.step].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Parameter ${i} has invalid numeric fields.`);
  }
  if(!Array.isArray(value.assumptions)||value.assumptions.length>30)throw new Error('Indicator assumptions are invalid.');
  for(const [i,item] of value.assumptions.entries())boundedString(item,`assumption ${i}`,500,false);
  return {name:value.name,description:value.description,code:value.code,parameters:value.parameters as GeneratedFields['parameters'],assumptions:value.assumptions as string[]};
}

function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function exactKeys(value:Record<string,unknown>,keys:string[]):boolean{const actual=Object.keys(value).sort();return actual.length===keys.length&&actual.every((key,i)=>key===[...keys].sort()[i]);}
function boundedString(value:unknown,label:string,max:number,nonempty:boolean):asserts value is string{if(typeof value!=='string'||value.length>max||(nonempty&&!value.trim()))throw new Error(`Indicator ${label} is invalid.`);}
