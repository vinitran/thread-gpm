import test from 'node:test';
import assert from 'node:assert/strict';
import {typeFormText} from './form-input.mjs';

test('form typing preserves graphemes and varies the pace between characters and fields',async()=>{
 const text='Trần Ngọc Linh 👩‍💻',parts=[],times=[],pauses=[];let elapsed=0,index=0;
 const values=[.1,.8,.2,.95,.4,.7];
 await typeFormText(text,async part=>{parts.push(part);times.push(elapsed);},{random:()=>values[index++%values.length],wait:async ms=>{pauses.push(ms);elapsed+=ms;}});
 assert.equal(parts.join(''),text);assert.ok(parts.includes('ầ'));assert.ok(parts.includes('👩‍💻'));
 const intervals=times.slice(1).map((time,i)=>time-times[i]);
 assert.ok(new Set(intervals).size>3);assert.ok(intervals.some(ms=>ms>=250));assert.ok(intervals.every(ms=>ms>=58));assert.ok(pauses.every(ms=>ms<=100));
 const durations=[];for(const random of [()=>0,()=>.99]){let duration=0;await typeFormText('abcdefghi',async()=>{},{random,wait:async ms=>{duration+=ms;}});durations.push(duration);}
 assert.notEqual(durations[0],durations[1]);
});

test('Stop during a typing pause cancels within one 100ms slice without inserting another character',async()=>{
 let active=true;const typed=[],waits=[];
 await assert.rejects(()=>typeFormText('a.bc',async part=>typed.push(part),{random:()=>.9,shouldContinue:()=>active,wait:async ms=>{waits.push(ms);active=false;}}),/Đã dừng/);
 assert.deepEqual(typed,['a']);assert.equal(waits.length,1);assert.ok(waits[0]<=100);
});

test('typing stops immediately when focus validation rejects a character and never inserts the rest',async()=>{
 const typed=[];await assert.rejects(()=>typeFormText('abcd',async char=>{if(typed.length===1)throw Error('Ô nhập đã mất focus.');typed.push(char);},{wait:async()=>{}}),/mất focus/);assert.deepEqual(typed,['a']);
});
