// The same deterministic planning engine runs locally and in the hosted Worker.
export const PROTOCOL = '2025-11-25';
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
};
function validDay(day, today) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z')) || addDays(day, 0) !== day) fail('Use a real date in YYYY-MM-DD format.');
  if (day < today || day > addDays(today, 27)) fail('Choose a date within the next 28 days.');
  return day;
}
export function emptyState() {
  return { revision: 0, tasks: [], capacities: {}, defaultMinutes: 120, plan: null, pending: null, history: [], events: [] };
}

export function schedule(state, today) {
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addDays(today, i);
    return { date, capacity: state.capacities[date] ?? state.defaultMinutes, used: 0, blocks: [] };
  });
  // Earliest deadline first is appropriate for splittable work on one time budget.
  // Importance breaks equal-deadline ties, never overrides a hard deadline.
  const tasks = state.tasks.filter(t => t.minutes > t.completed).sort((a,b) => a.due.localeCompare(b.due) || b.importance - a.importance || a.id.localeCompare(b.id));
  const risks = [];
  for (const task of tasks) {
    let remaining = task.minutes - task.completed;
    for (const day of days) {
      if (day.date > task.due || remaining <= 0) break;
      const free = day.capacity - day.used;
      if (free <= 0) continue;
      let assigned = Math.min(free, remaining);
      while (assigned > 0) {
        const minutes = Math.min(45, assigned);
        day.blocks.push({ taskId: task.id, title: task.title, subject: task.subject, minutes, due: task.due, importance: task.importance });
        day.used += minutes;
        remaining -= minutes;
        assigned -= minutes;
      }
    }
    if (remaining > 0) risks.push({ taskId: task.id, title: task.title, due: task.due, missingMinutes: remaining, reason: task.due < today ? 'The deadline has passed.' : `There is not enough available time on or before ${task.due}.` });
  }
  const horizon = Math.max(7, ...tasks.map(t => Math.min(28, Math.round((Date.parse(t.due)-Date.parse(today))/86400000)+1)));
  const visible = days.slice(0, horizon);
  return {
    startDate: today, days: visible, risks,
    totalMinutes: tasks.reduce((sum,t) => sum + t.minutes - t.completed, 0),
    scheduledMinutes: days.reduce((sum,d) => sum + d.used, 0),
    capacityMinutes: visible.reduce((sum,d) => sum + d.capacity, 0),
    missingMinutes: risks.reduce((sum,r) => sum + r.missingMinutes, 0),
    explanation: 'Work is split into sessions of up to 45 minutes. Earlier deadlines come first; importance breaks ties. Sessions never exceed a day’s capacity or run after a deadline. Estimated work time excludes breaks: set availability to your net focused minutes.'
  };
}

function checkpoint(state, label) {
  state.history.push({ label, tasks: clone(state.tasks), capacities: clone(state.capacities), plan: clone(state.plan) });
  state.history = state.history.slice(-8);
}
function event(state, text) { state.events.unshift({ text, at: new Date().toISOString() }); state.events = state.events.slice(0, 12); }
function view(state, today) {
  return { ...clone(state), today, computedPlan: schedule(state, today), canUndo: state.history.length > 0, history: state.history.map(h => ({ label: h.label })) };
}
const properties = p => ({ type: 'object', properties: p, additionalProperties: false });
const text = description => ({ type: 'string', description });
const number = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
const schemas = {
  get_workspace: properties({}),
  load_demo: properties({}),
  add_task: { ...properties({ title: { ...text('A concrete deliverable'), minLength: 1, maxLength: 100 }, subject: { ...text('Course or project'), maxLength: 40 }, due: { ...text('Local deadline date YYYY-MM-DD; work may run through this date'), format: 'date' }, minutes: number('Estimated focused work minutes',15,2400), importance: number('1=normal, 2=important, 3=critical',1,3) }), required: ['title','due','minutes'] },
  build_plan: properties({}),
  preview_availability: { ...properties({ date: { ...text('Local date YYYY-MM-DD'), format: 'date' }, minutes: number('Available focused minutes, excluding breaks. Replaces the capacity for this date.',0,480) }), required: ['date','minutes'] },
  confirm_plan: { ...properties({ proposal_id: text('The proposal ID returned by preview_availability'), confirmed: { type: 'boolean', const: true, description: 'True only after the user approves the displayed changes and risks' } }), required: ['proposal_id','confirmed'] },
  record_progress: { ...properties({ task_id: text('Task ID from get_workspace'), minutes: number('Focused minutes actually completed',1,2400) }), required: ['task_id','minutes'] },
  undo_change: properties({})
};
const descriptions = {
  get_workspace: 'Read deadlines, progress, saved memory, current capacity, an explainable feasible plan, and any pending proposal.',
  load_demo: 'Load a clearly fictional student week into an empty workspace. Never overwrites existing tasks.',
  add_task: 'Save a deadline and effort estimate. Invalidate any pending plan. Ask the user for missing dates or estimates.',
  build_plan: 'Create and save an earliest-deadline-first study plan. Report unschedulable work explicitly; never invent spare time.',
  preview_availability: 'Preview an availability change and replan. Combine with any pending change. Return risks and differences. Does not change committed capacity; ask for user approval before confirm_plan.',
  confirm_plan: 'Apply the exact pending availability proposal only after the user explicitly approves. The proposal ID must still match. Reversible with undo_change.',
  record_progress: 'Record actual completed study minutes, reduce remaining effort, and replan. Reject over-completion. Reversible.',
  undo_change: 'Restore the last committed change, including task progress and capacity. Pending proposals are discarded.'
};
export const tools = Object.keys(schemas).map(name => ({ name, title: name.replaceAll('_',' '), description: descriptions[name], inputSchema: schemas[name], annotations: { readOnlyHint: name === 'get_workspace', destructiveHint: false, idempotentHint: ['get_workspace','build_plan'].includes(name), openWorldHint: false } }));

export function runTool(input, name, args = {}, today) {
  if (!schemas[name]) fail('Unknown tool.');
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('Arguments must be an object.');
  for (const key of Object.keys(args)) if (!(key in schemas[name].properties)) fail(`Unexpected argument: ${key}`);
  for (const key of schemas[name].required ?? []) if (!(key in args)) fail(`Missing required argument: ${key}`);
  const state = clone(input);
  if (name === 'get_workspace') return { state, data: view(state, today), mutated: false };
  let message = '';
  if (name === 'load_demo') {
    if (state.tasks.length) fail('Demo data can only be loaded into an empty workspace. Your work was preserved.');
    checkpoint(state, 'Load sample week');
    state.tasks = [
      { id:'algebra', title:'Linear algebra quiz', subject:'Mathematics', due:addDays(today,1), minutes:180, completed:0, importance:3 },
      { id:'algorithms', title:'Algorithms problem set', subject:'Computer science', due:addDays(today,3), minutes:240, completed:0, importance:2 },
      { id:'systems', title:'Systems reading notes', subject:'Computer science', due:addDays(today,5), minutes:180, completed:0, importance:1 },
      { id:'research', title:'Research outline', subject:'Research', due:addDays(today,6), minutes:150, completed:0, importance:2 }
    ];
    state.pending = null; state.plan = schedule(state, today);
    message = 'A fictional sample week is ready. All 12.5 hours fit within your available time.';
  } else if (name === 'add_task') {
    if (typeof args.title !== 'string' || !args.title.trim() || args.title.length > 100) fail('Give the task a title between 1 and 100 characters.');
    if (args.subject !== undefined && (typeof args.subject !== 'string' || args.subject.length > 40)) fail('Subject must be at most 40 characters.');
    if (state.tasks.length >= 100) fail('This workspace supports up to 100 tasks.');
    const task = { id:crypto.randomUUID(), title:args.title.trim(), subject:args.subject?.trim() || 'Personal', due:validDay(args.due,today), minutes:integer(args.minutes,15,2400,'Estimated minutes'), completed:0, importance:integer(args.importance ?? 2,1,3,'Importance') };
    checkpoint(state, `Add ${task.title}`); state.tasks.push(task); state.pending = null; state.plan = schedule(state,today);
    message = `Saved ${task.title}. Its effort and deadline are now part of your plan.`;
  } else if (name === 'build_plan') {
    if (!state.tasks.length) fail('Add a deadline or load the sample week first.');
    checkpoint(state,'Build study plan'); state.plan = schedule(state,today); state.pending = null;
    message = state.plan.risks.length ? `${state.plan.missingMinutes} minutes do not fit before their deadlines. The plan marks this work as at risk.` : 'Your plan fits. Every session is inside your available time and on or before its deadline.';
  } else if (name === 'preview_availability') {
    if (!state.tasks.length) fail('Add a deadline or load the sample week first.');
    validDay(args.date,today); integer(args.minutes,0,480,'Available minutes');
    const changes = { ...(state.pending?.changes ?? {}), [args.date]:args.minutes };
    const candidate = { ...state, capacities:{ ...state.capacities, ...changes } };
    const before = schedule(state,today), after = schedule(candidate,today);
    const key = day => day.blocks.map(b => `${b.taskId}:${b.minutes}`).join('|');
    state.pending = { id:crypto.randomUUID(), createdAt:new Date().toISOString(), changes, plan:after, changedDays:after.days.filter(day => { const old = before.days.find(d => d.date===day.date); return !old || old.capacity!==day.capacity || key(old)!==key(day); }).map(d => d.date), previousMissing:before.missingMinutes };
    message = after.risks.length ? `This change leaves ${after.missingMinutes} minutes unscheduled before deadlines. Review the risk before applying. No committed availability has changed.` : 'The revised plan fits every deadline. Review it, then apply when you are ready.';
  } else if (name === 'confirm_plan') {
    if (args.confirmed !== true) fail('Explicit user approval is required.');
    if (!state.pending || state.pending.id !== args.proposal_id) fail('This proposal is no longer current. Preview your change again.');
    // A new day changes which sessions are still usable; require a fresh preview.
    if (state.pending.plan.startDate !== today) fail('The day has changed. Preview your availability again before applying.');
    checkpoint(state,'Apply revised availability');
    state.capacities = { ...state.capacities, ...state.pending.changes };
    state.plan = state.pending.plan; state.pending = null;
    message = state.plan.risks.length ? `Plan applied with ${state.plan.missingMinutes} minutes still at risk. Your deadlines were not moved.` : 'Your revised plan is saved. All deadlines fit, and your original deadlines are unchanged.';
  } else if (name === 'record_progress') {
    const task = state.tasks.find(t=>t.id===args.task_id);
    if (!task) fail('Task not found. Refresh the workspace.');
    integer(args.minutes,1,2400,'Completed minutes');
    if (args.minutes > task.minutes-task.completed) fail('Completed minutes cannot exceed the remaining estimate.');
    checkpoint(state,`Record progress on ${task.title}`); task.completed += args.minutes;
    state.pending = null; state.plan = schedule(state,today);
    message = `Recorded ${args.minutes} minutes on ${task.title}. ${task.minutes-task.completed} minutes remain.`;
  } else if (name === 'undo_change') {
    const prior = state.history.pop();
    if (!prior) fail('There is no committed change to undo.');
    state.tasks = prior.tasks; state.capacities = prior.capacities; state.plan = prior.plan; state.pending = null;
    message = `Undid: ${prior.label}. Your previous state is restored.`;
  }
  state.revision += 1; event(state,message);
  return { state, mutated:true, data:{ message, ...view(state,today) } };
}
