import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,schedule,runTool,addDays} from '../src/core.js';
const today='2026-10-21';
const call=(state,name,args={})=>runTool(state,name,args,today);
const demo=()=>call(emptyState(),'load_demo').state;
test('Lost-day recovery previews, preserves deadlines, requires approval, rejects stale IDs and supports undo',()=>{
  let state=demo();const deadlines=state.tasks.map(t=>t.due);assert.equal(schedule(state,today).missingMinutes,0);
  state=call(state,'preview_availability',{date:today,minutes:0}).state;
  assert.equal(state.capacities[today],undefined);assert.equal(state.pending.plan.missingMinutes,60);
  assert.throws(()=>call(state,'confirm_plan',{proposal_id:state.pending.id,confirmed:false}),/approval/);
  const stale=state.pending.id;
  state=call(state,'preview_availability',{date:addDays(today,1),minutes:180}).state;
  assert.equal(state.pending.plan.missingMinutes,0);assert.equal(state.pending.changes[today],0);
  assert.throws(()=>call(state,'confirm_plan',{proposal_id:stale,confirmed:true}),/no longer current/);
  state=call(state,'confirm_plan',{proposal_id:state.pending.id,confirmed:true}).state;
  assert.equal(state.capacities[today],0);assert.equal(state.capacities[addDays(today,1)],180);assert.deepEqual(state.tasks.map(t=>t.due),deadlines);
  state=call(state,'undo_change').state;assert.deepEqual(state.capacities,{});
});
test('Progress reduces work, clears proposals and is reversible',()=>{
  let state=call(demo(),'preview_availability',{date:today,minutes:0}).state;
  state=call(state,'record_progress',{task_id:'algebra',minutes:45}).state;
  assert.equal(state.tasks[0].completed,45);assert.equal(state.pending,null);assert.equal(schedule(state,today).totalMinutes,705);
  assert.throws(()=>call(state,'record_progress',{task_id:'algebra',minutes:999}),/exceed/);
  assert.equal(call(state,'undo_change').state.tasks[0].completed,0);
});
test('Invalid dates, budgets, fields and demo overwrites are rejected',()=>{
  const state=demo();assert.throws(()=>call(state,'load_demo'),/preserved/);
  for(const date of ['2026-02-30','not-a-date','2026-10-20','2027-01-01'])assert.throws(()=>call(state,'preview_availability',{date,minutes:60}));
  for(const minutes of [-1,481,1.5,'120'])assert.throws(()=>call(state,'preview_availability',{date:today,minutes}));
  assert.throws(()=>call(state,'add_task',{title:'X',due:today,minutes:60,admin:true}),/Unexpected/);
  assert.throws(()=>call(state,'add_task',{title:'X',minutes:60}),/Missing/);
});
test('A proposal from yesterday cannot be applied today',()=>{
  const state=call(demo(),'preview_availability',{date:addDays(today,1),minutes:90}).state;
  assert.throws(()=>runTool(state,'confirm_plan',{proposal_id:state.pending.id,confirmed:true},addDays(today,1)),/day has changed/);
});
test('120 workloads preserve effort, capacity and deadline invariants',()=>{
  let seed=19;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  for(let trial=0;trial<120;trial++){
    const state=emptyState();for(let i=0;i<28;i++)state.capacities[addDays(today,i)]=rand(17)*15;
    state.tasks=Array.from({length:1+rand(20)},(_,i)=>({id:'t'+i,title:'Task '+i,subject:'Test',minutes:15+rand(50)*15,completed:0,due:addDays(today,rand(28)),importance:1+rand(3)}));
    const plan=schedule(state,today);
    for(const day of plan.days){assert.ok(day.used<=day.capacity);assert.equal(day.used,day.blocks.reduce((s,b)=>s+b.minutes,0));for(const b of day.blocks){assert.ok(b.minutes>0&&b.minutes<=45);assert.ok(day.date<=b.due);}}
    for(const task of state.tasks){const assigned=plan.days.flatMap(d=>d.blocks).filter(b=>b.taskId===task.id).reduce((s,b)=>s+b.minutes,0);const missing=plan.risks.find(r=>r.taskId===task.id)?.missingMinutes??0;assert.equal(assigned+missing,task.minutes);}
    assert.equal(plan.scheduledMinutes+plan.missingMinutes,plan.totalMinutes);
  }
});
