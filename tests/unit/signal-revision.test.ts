import {describe,it,expect} from 'vitest';
import {parseSignalRevision,signalRevisionError} from '../../src/lib/signal-revision';
import {initialState,applyCommand} from '../../src/lib/domain';
describe('explicit signal revision',()=>{
 it('distinguishes current, valid and invalid queries',()=>{
  expect(parseSignalRevision('')).toBeNull();expect(parseSignalRevision('revision=1')).toBe(1);
  for(const value of ['','0','-1','abc','1.5','Infinity','9007199254740992','01','1&revision=2'])expect(parseSignalRevision('revision='+value)).toBeNaN();
 });
 it('never resolves missing history to current',()=>{
  const s=applyCommand(initialState(),{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Review'},'review');
  expect(signalRevisionError(s,'SQ-002',null)).toBe('');expect(signalRevisionError(s,'SQ-002',1)).toBe('');
  expect(signalRevisionError(s,'SQ-002',999)).toBe('Версия не найдена');expect(signalRevisionError(s,'SQ-002',NaN)).toBe('Некорректная версия сигнала');
 });
});
