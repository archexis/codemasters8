import {describe,it,expect} from 'vitest';
import {applyCommand} from '../../src/lib/domain';
import {previewLocalImport,localImportCommands,importRecordSchema,parseImportFile,importIdentity} from '../../src/lib/registry-import';
import {hasCoordinates} from '../../src/lib/map-model';
import {dossierTimeline,dossierRelations} from '../../src/lib/dossier-context';
import {computeScore} from '../../src/lib/scoring';
import {loadStateFromText} from '../../src/lib/state-migrations';
import type {AppState} from '../../src/lib/types';
import {resetDemo,saveCommand,withCommandId} from '../../src/lib/repository';

const empty=():AppState=>({schemaVersion:3,complexes:[],ads:[],media:[],signals:{},signalVersions:{},artifacts:[],audit:[]});
const row={name:'ЖК Тест импорта',city:'Усть-Каменогорск',address:'ул. Тестовая, 1/2',developer:'Тестовая организация',developer_bin:'001234567890',construction_status:'under_construction',source_url:'https://krisha.kz/complex/test-import/',observed_at:null};
const chosen=['krisha','egov','developers'] as const;

describe('registry import',()=>{
  it('merges sources, preserves provenance and unknown dates without inventing coordinates or risk',async()=>{
    let state=empty();const preview=await previewLocalImport([row,{...row,name:'Тест импорта',source_url:'https://developers.kz/test-import/'},row],[...chosen],state);
    expect(preview.candidates).toHaveLength(1);expect(preview.candidates[0].sources).toHaveLength(2);
    const commands=await localImportCommands(preview,[preview.candidates[0].id],state);
    expect(commands).toHaveLength(3);for(const command of commands)state=applyCommand(state,command,'Аналитик');
    const building=state.complexes[0];expect(building).toMatchObject({demo:false,origin:'import',bin:'001234567890',city:'Өскемен',legalBasis:{status:'unknown'}});
    expect(hasCoordinates(building)).toBe(false);expect(computeScore(building.factors).score).toBe(0);
    expect(state.artifacts).toHaveLength(2);expect(state.artifacts?.[0].date).toBeUndefined();
    const provenance=JSON.parse(state.artifacts![0].text);expect(provenance).toMatchObject({verification_status:'unverified',source_type:'commercial_catalog',observed_at:null,access_method:'prepared_export'});expect(provenance.retrieved_at).toBeTruthy();
    expect(dossierTimeline(state,building.id).every(e=>e.occurredAt===null)).toBe(true);expect(dossierRelations(state,building.id).filter(r=>r.type==='covered_by')).toHaveLength(2);
    expect(()=>loadStateFromText(JSON.stringify(state))).not.toThrow();
    const repeat=await previewLocalImport([row,{...row,name:'Тест импорта',source_url:'https://developers.kz/test-import/'}],[...chosen],state);
    expect(repeat.candidates[0].action).toBe('duplicate');expect(await localImportCommands(repeat,[repeat.candidates[0].id],state)).toEqual([]);
  });
  it('blocks conflicting BINs, ambiguous existing and partial in-batch address matches',async()=>{
    const conflicting=await previewLocalImport([row,{...row,developer_bin:'991234567890',source_url:'https://developers.kz/a/'}],[...chosen],empty());
    expect(conflicting.candidates[0].action).toBe('review');expect(await localImportCommands(conflicting,[conflicting.candidates[0].id],empty())).toEqual([]);
    const ambiguous=await previewLocalImport([row,{...row,address:'ул. Тестовая, 2'}],[...chosen],empty());expect(ambiguous.candidates.every(c=>c.action==='review')).toBe(true);
    expect(importIdentity({...row,address:'ул. Тестовая, 12'})).not.toBe(importIdentity(row));
  });
  it('retains reviewed existing fields and risk when adding a new source',async()=>{
    let state=empty();let p=await previewLocalImport([row],[...chosen],state);for(const c of await localImportCommands(p,[p.candidates[0].id],state))state=applyCommand(state,c,'Аналитик');
    state.complexes[0].stage='Ручное значение';const before=structuredClone(state.complexes[0]);p=await previewLocalImport([{...row,source_url:'https://developers.kz/another-source/'}],[...chosen],state);
    expect(p.candidates[0].action).toBe('enrich');const commands=await localImportCommands(p,[p.candidates[0].id],state);expect(commands.every(c=>c.type==='artifact.register')).toBe(true);for(const c of commands)state=applyCommand(state,c,'Аналитик');expect(state.complexes[0]).toEqual(before);
  });
  it('rejects unsafe URLs, malformed rows, foreign cities, impossible dates and unpaired coordinates',async()=>{
    const p=await previewLocalImport([{...row,city:'Алматы'},{...row,observed_at:'2026-02-30'},{...row,lat:49},{...row,source_url:'https://krisha.kz.evil.test/a'},{...row,source_url:'https://data.egov.kz/a?apiKey=secret'},{...row,developer_bin:123456789012}], [...chosen],empty());
    expect(p.candidates).toEqual([]);expect(p.errors).toHaveLength(6);
    expect(()=>importRecordSchema.parse({...row,source_url:'javascript:alert(1)'})).toThrow();
    const csv='name,city,address,source_url,developer_bin\nТест,Өскемен,Адрес,https://krisha.kz/a,001234567890';expect((parseImportFile(csv,'a.csv')[0] as any).developer_bin).toBe('001234567890');
    expect(()=>parseImportFile('{}','a.json')).toThrow();
  });
  it('does not turn a stale local creation intent into an overwrite across tabs',async()=>{
    let state=await resetDemo();const preview=await previewLocalImport([row],[...chosen],state);
    const create=(await localImportCommands(preview,[preview.candidates[0].id],state))[0];
    state=await saveCommand(state,withCommandId(create,'registry-create-first'),'Аналитик');
    expect(create.type).toBe('complex');if(create.type!=='complex')throw new Error('fixture');
    state=await saveCommand(state,{type:'complex',complex:{...create.complex,note:'Ручное уточнение после импорта'}},'Аналитик');
    await expect(saveCommand(state,withCommandId(create,'registry-create-other-tab'),'Аналитик')).rejects.toThrow('Объект уже создан');
    expect(state.complexes.find(z=>z.id===create.complex.id)?.note).toBe('Ручное уточнение после импорта');
  });
});
