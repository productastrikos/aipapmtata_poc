import React, { useState } from 'react';
import { executeAdvisoryAction } from '../services/api';

const PRIORITY_META = {
  critical:    { border:'border-white/35', bg:'', badge:'bg-red-500/60 text-white font-semibold px-1.5 py-0.5 rounded',        label:'CRITICAL' },
  high:        { border:'border-white/35', bg:'', badge:'bg-orange-500/60 text-white font-semibold px-1.5 py-0.5 rounded',     label:'HIGH' },
  medium:      { border:'border-white/35', bg:'', badge:'bg-amber-400/60 text-black font-semibold px-1.5 py-0.5 rounded',      label:'MEDIUM' },
  info:        { border:'border-white/35', bg:'', badge:'bg-blue-500/60 text-white font-semibold px-1.5 py-0.5 rounded',       label:'INFO' },
  low:         { border:'border-white/35', bg:'', badge:'bg-slate-400/60 text-white font-semibold px-1.5 py-0.5 rounded',      label:'LOW' },
  predictive:  { border:'border-white/35', bg:'', badge:'bg-violet-500/60 text-white font-semibold px-1.5 py-0.5 rounded',    label:'PREDICTIVE' },
};

// Safely render an evidence item â€” never shows raw JSON
const toEvidenceStr = (e) => {
  if (typeof e === 'string') return e;
  if (!e || typeof e !== 'object') return String(e);
  if (e.detail)   return e.detail;
  if (e.message)  return e.message;
  if (e.bin  && (e.fill    !== undefined)) return e.bin  + ': ' + e.fill    + '% fill';
  if (e.vehicle && e.status) return e.vehicle + ': ' + e.status;
  // Generic: join all string/number kv pairs in readable form
  return Object.entries(e)
    .filter(([,v]) => typeof v !== 'object')
    .map(([k,v]) => k.replace(/_/g,' ') + ': ' + v)
    .join(' Â· ');
};

// Safely render a recommendation item â€” never shows raw JSON
const toRecStr = (r) => {
  if (typeof r === 'string') return r;
  if (!r || typeof r !== 'object') return String(r);
  return r.action || r.recommendation || r.step || r.text ||
    Object.values(r).filter(v => typeof v === 'string' && v.length > 6)[0] ||
    Object.entries(r).map(([k,v]) => k.replace(/_/g,' ') + ': ' + v).join(' Â· ');
};

// Format impact value â€” handle both numbers and pre-formatted strings
const fmtImpact = (v) => {
  if (typeof v === 'number') return (v > 0 ? '+' : '') + v + '%';
  return String(v);
};

// Capitalise each word; convert underscores to spaces
const titleCase = (s = '') => s.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());

const STATIC_ADVISORIES = [
  {
    advisoryId:'ADV-001', priority:'high',
    title:'Segment B utilization above 70% â€” schedule additional capacity before end of shift',
    template:'overflow_cluster',
    rootCause:{
      primary:'Segment B (East) has reached 71.2% utilization and is trending toward the 75% warning threshold. Current intake rate suggests capacity will be exceeded within the next 2 hours unless additional resources are allocated.',
      contributing:'Three items are queued and unassigned. The afternoon shift handover has not yet been confirmed.',
      systemic:'This is a recurring pattern for Segment B on weekday afternoons. A standing pre-allocation rule for peak hours would prevent recurrence.',
    },
    evidence:[
      'Segment B utilization: 71.2% and rising at +0.8%/hr',
      'Queue depth: 3 unassigned items pending allocation',
      'Shift handover confirmation: pending',
    ],
    recommendations:[
      'Pre-allocate AST-003 to Segment B for the 14:00â€“18:00 window',
      'Clear unassigned queue items before shift handover',
      'Set automated alert at 68% for this segment going forward',
    ],
    impact: '+8% capacity headroom recoverable within 30 minutes',
    actions:[
      { type:'dispatch_crew',   label:'Assign Resource' },
      { type:'create_work_order', label:'Create Work Order' },
    ],
  },
  {
    advisoryId:'ADV-002', priority:'medium',
    title:'Three service requests have exceeded SLA response window â€” escalation recommended',
    template:'sla_breach',
    rootCause:{
      primary:'SRQ-001, SRQ-004, and SRQ-010 are all high-priority billing inquiries that have been open for more than 1 hour without assignment. The SLA target is 30 minutes for high-priority requests.',
      contributing:'No agent is currently assigned to the billing queue.',
      systemic:'Billing requests tend to spike on Mondays. Consider a dedicated billing agent slot for Monday AM.',
    },
    evidence:[
      'SRQ-001: open 15 min â€” Billing â€” high priority â€” unassigned',
      'SRQ-004: open 30 min â€” Support â€” high priority â€” unassigned',
      'SRQ-010: open 20 min â€” Billing â€” high priority â€” unassigned',
    ],
    recommendations:[
      'Assign the three open high-priority requests immediately',
      'Send automated acknowledgement to each requester',
      'Review billing queue staffing for peak Monday hours',
    ],
    impact: 'SLA compliance recoverable to 95%+ within 15 minutes with immediate assignment',
    actions:[
      { type:'notify_citizens', label:'Notify Requesters' },
      { type:'create_work_order', label:'Escalate to Manager' },
    ],
  },
];

const ACTION_FORMS = {
  dispatch_crew: {
    title: 'Assign Resource',
    color: 'cyan',
    fields: [
      { key:'segment',  label:'Target Segment',     type:'select',   opts:['All Segments','Segment A â€“ North','Segment B â€“ East','Segment C â€“ Central','Segment D â€“ West','Segment E â€“ South'] },
      { key:'asset',    label:'Resource Unit',       type:'select',   opts:['AST-001 â€“ Unit A','AST-002 â€“ Unit B','AST-003 â€“ Unit C','AST-004 â€“ Unit D','AST-005 â€“ Unit E'] },
      { key:'priority', label:'Assignment Priority', type:'select',   opts:['Immediate (< 15 min)','High (< 30 min)','Standard (< 60 min)'] },
      { key:'notes',    label:'Notes',               type:'textarea', placeholder:'Special instructions...'},
    ],
  },
  optimize_routes: {
    title: 'Optimize Schedule',
    color: 'emerald',
    fields: [
      { key:'segments', label:'Target Segments',     type:'select',   opts:['All Segments','Segment A â€“ North','Segment B â€“ East','Segment C â€“ Central','Segment D â€“ West','Segment E â€“ South'] },
      { key:'mode',     label:'Optimization Mode',   type:'select',   opts:['Cost Efficiency','Time (fastest)','Coverage (maximum reach)','Balanced'] },
      { key:'window',   label:'Apply To Window',     type:'select',   opts:['Current Shift','Next Shift','Both Shifts','Next 7 Days'] },
      { key:'notes',    label:'Additional Notes',    type:'textarea', placeholder:'Any constraints or special requirements...'},
    ],
  },
  notify_citizens: {
    title: 'Send Notification',
    color: 'amber',
    fields: [
      { key:'group',    label:'Target Group',        type:'select',   opts:['All Groups','Group A','Group B','Group C','Group D','Group E'] },
      { key:'channel',  label:'Notification Channel',type:'select',  opts:['In-App Only','Email Only','Email + In-App','SMS + Email + In-App'] },
      { key:'type',     label:'Message Type',        type:'select',  opts:['Service Delay','Completion Notice','Alert','Reminder'] },
      { key:'message',  label:'Custom Message',      type:'textarea', placeholder:'Enter the notification message...'},
    ],
  },
  create_work_order: {
    title: 'Create Work Order',
    color: 'purple',
    fields: [
      { key:'title',    label:'Work Order Title',    type:'text',     placeholder:'e.g. Urgent review â€“ Segment B backlog' },
      { key:'team',     label:'Assigned Team',       type:'select',   opts:['Operations Team','Emergency Response','Maintenance Crew','Quality Review','Management'] },
      { key:'priority', label:'Priority Level',      type:'select',   opts:['CRITICAL â€“ Same day','HIGH â€“ Within 24 hours','LOW â€“ Scheduled'] },
      { key:'due',      label:'Due Date / Time',     type:'text',     placeholder:'e.g. 2026-06-15 14:00' },
      { key:'desc',     label:'Description',         type:'textarea', placeholder:'Describe the work required in detail...'},
    ],
  },
};

const COLOR_MAP = {
  cyan:   { ring:'focus:ring-cyan-700/30',    btn:'bg-cyan-600/15 border border-cyan-700/50 text-cyan-800 hover:bg-cyan-600/25' },
  emerald:{ ring:'focus:ring-emerald-700/30', btn:'bg-emerald-600/15 border border-emerald-700/50 text-emerald-800 hover:bg-emerald-600/25' },
  amber:  { ring:'focus:ring-amber-700/30',   btn:'bg-amber-600/15 border border-amber-700/50 text-amber-800 hover:bg-amber-600/25' },
  purple: { ring:'focus:ring-purple-700/30',  btn:'bg-purple-600/15 border border-purple-700/50 text-purple-900 hover:bg-purple-600/25' },
};

export default function AdvisoryPanel({ advisories = [], onClose }) {
  // Always use the curated static advisories â€” server-generated ones are all
  // templated from the same pattern and appear visually identical.
  const merged = (advisories && advisories.length) ? advisories : STATIC_ADVISORIES;

  const [expandedId, setExpandedId] = useState('ADV-001');
  const [executing,  setExecuting]  = useState(null);
  const [actionForm, setActionForm] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const openForm = (actionType, advisory) => {
    const cfg = ACTION_FORMS[actionType];
    if (!cfg) return;
    const defaults = {};
    cfg.fields.forEach(f => { defaults[f.key] = f.opts?.[0] ?? ''; });
    setActionForm({ actionType, advisoryId: advisory.advisoryId, advisoryTitle: advisory.title, formValues: defaults });
  };

  const submitForm = async () => {
    if (!actionForm) return;
    const key = actionForm.advisoryId + '-' + actionForm.actionType;
    setExecuting(key);
    try {
      await executeAdvisoryAction(actionForm.advisoryId, actionForm.actionType, actionForm.formValues);
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(null);
      const cfg = ACTION_FORMS[actionForm.actionType];
      setSuccessMsg((cfg?.title || 'Action') + ' submitted successfully');
      setActionForm(null);
      setTimeout(() => setSuccessMsg(null), 3200);
    }
  };

  const formClrKey = actionForm ? (ACTION_FORMS[actionForm.actionType]?.color || 'cyan') : 'cyan';
  const formClr    = COLOR_MAP[formClrKey] || COLOR_MAP.cyan;

  return (
    <div className="h-full flex flex-col relative overflow-hidden">

      {/* SUCCESS TOAST */}
      {successMsg && (
        <div className="absolute top-14 left-2 right-2 z-50 bg-emerald-500/20 border border-emerald-500/40 rounded-lg px-3 py-2 text-[10px] text-emerald-400 font-semibold shadow-xl">
          âœ“ {successMsg}
        </div>
      )}

      {/* HEADER */}
      <div className="px-4 py-3 border-b border-app-border flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-base font-semibold text-black">AI Advisories</h3>
          <p className="text-xs text-black/60">{merged.length} active recommendations</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* ACTION FORM PANEL (slides over the list) */}
      {actionForm && (
        <div className="absolute inset-x-0 bottom-0 z-40 bg-app-darker flex flex-col border-t border-app-border" style={{top:53}}>
          {/* Form header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
            <div>
              <p className="text-[11px] font-bold text-black">{ACTION_FORMS[actionForm.actionType]?.title}</p>
              <p className="text-[9px] text-slate-400 mt-0.5 line-clamp-1">{actionForm.advisoryTitle}</p>
            </div>
            <button onClick={() => setActionForm(null)} className="text-slate-400 hover:text-white text-xl leading-none transition-colors w-7 h-7 flex items-center justify-center rounded hover:bg-white/10">Ã—</button>
          </div>

          {/* Form fields */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {ACTION_FORMS[actionForm.actionType]?.fields.map(field => (
              <div key={field.key}>
                <label className="block text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    value={actionForm.formValues[field.key] || ''}
                    onChange={e => setActionForm(f => ({ ...f, formValues: { ...f.formValues, [field.key]: e.target.value } }))}
                    className={'w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:ring-1 ' + formClr.ring}>
                    {field.opts.map(o => <option key={o} value={o} className="bg-slate-900 text-slate-200">{o}</option>)}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    rows={3}
                    value={actionForm.formValues[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={e => setActionForm(f => ({ ...f, formValues: { ...f.formValues, [field.key]: e.target.value } }))}
                    className={'w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-slate-200 placeholder-slate-400 resize-none focus:outline-none focus:ring-1 ' + formClr.ring}
                  />
                ) : (
                  <input
                    type="text"
                    value={actionForm.formValues[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={e => setActionForm(f => ({ ...f, formValues: { ...f.formValues, [field.key]: e.target.value } }))}
                    className={'w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 ' + formClr.ring}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Submit area */}
          <div className="px-4 pb-4 pt-2 shrink-0 space-y-1.5 border-t border-app-border">
            <button
              onClick={submitForm}
              disabled={!!executing}
              className={'w-full py-2.5 text-[11px] font-bold rounded-lg border transition-colors disabled:opacity-50 ' + formClr.btn}>
              {executing ? 'Submittingâ€¦' : 'Submit ' + (ACTION_FORMS[actionForm.actionType]?.title || 'Action')}
            </button>
            <button onClick={() => setActionForm(null)}
              className="w-full py-2 text-[10px] text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ADVISORY LIST */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
        {merged.map((advisory, idx) => {
          const isExpanded = expandedId === advisory.advisoryId;
          const pm = PRIORITY_META[advisory.priority] || PRIORITY_META.low;
          const recs = Array.isArray(advisory.recommendations)
            ? advisory.recommendations
            : advisory.recommendations ? Object.values(advisory.recommendations).flat() : [];
          const impactEntries = advisory.impact ? Object.entries(advisory.impact).slice(0, 4) : [];

          return (
            <div key={advisory.advisoryId}
              className={'advisory-card rounded-xl overflow-hidden transition-all duration-200 ' + pm.bg}
              style={{ background: '#d9d3ff' }}>

              {/* â”€â”€ Card header (always visible) â”€â”€ */}
              <button className="w-full text-left px-3.5 pt-3 pb-2.5 group"
                onClick={() => setExpandedId(isExpanded ? null : advisory.advisoryId)}>

                {/* Top row: index badge + priority dot + advisory ID + chevron */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className={'text-[10px] ' + pm.badge}>{pm.label}</span>
                    <span className="text-[10px] text-white">{titleCase(advisory.template)}</span>
                  </div>
                  <svg className={'w-3.5 h-3.5 text-white transition-transform group-hover:text-white/70 ' + (isExpanded ? 'rotate-180' : '')}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Advisory title */}
                <p className="text-[13px] font-semibold leading-snug pr-1">{advisory.title}</p>


              </button>

              {/* â”€â”€ Expanded body â”€â”€ */}
              {isExpanded && (
                <div className="border-t-2 border-black/15 divide-y-2 divide-black/10">

                  {/* ROOT CAUSE */}
                  {advisory.rootCause && (
                    <div className="px-3.5 py-3">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-2">Root Cause</p>
                      <div className="pl-2 border-l-4 border-black/25 space-y-1.5">
                        {typeof advisory.rootCause === 'object' ? (
                          <>
                            {advisory.rootCause.primary      && (
                              <div>
                                <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Primary Â· </span>
                                <span className="text-xs text-white">{advisory.rootCause.primary}</span>
                              </div>
                            )}
                            {advisory.rootCause.contributing && (
                              <div>
                                <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Contributing Â· </span>
                                <span className="text-xs text-white">{advisory.rootCause.contributing}</span>
                              </div>
                            )}
                            {advisory.rootCause.systemic     && (
                              <div>
                                <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Systemic Â· </span>
                                <span className="text-xs text-white">{advisory.rootCause.systemic}</span>
                              </div>
                            )}
                            {/* Catch any extra keys not handled above */}
                            {Object.keys(advisory.rootCause)
                              .filter(k => !['primary','contributing','systemic'].includes(k))
                              .map(k => (
                                <div key={k}>
                                  <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">{titleCase(k)} Â· </span>
                                  <span className="text-xs text-white">
                                    {typeof advisory.rootCause[k] === 'object'
                                      ? Object.values(advisory.rootCause[k]).join(', ')
                                      : String(advisory.rootCause[k])}
                                  </span>
                                </div>
                              ))}
                          </>
                        ) : (
                          <p className="text-xs text-white">{String(advisory.rootCause)}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* EVIDENCE */}
                  {advisory.evidence?.length > 0 && (
                    <div className="px-3.5 py-3">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-2">Evidence</p>
                      <div className="space-y-1">
                        {advisory.evidence.slice(0, 5).map((e, i) => (
                          <div key={i} className="flex items-start space-x-2">
                            <span className="text-[10px] text-white/50 mt-0.5 shrink-0 tabular-nums">{i + 1}.</span>
                            <p className="text-xs text-white leading-snug">{toEvidenceStr(e)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* RECOMMENDATIONS */}
                  {recs.length > 0 && (
                    <div className="px-3.5 py-3">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-2">Recommendations</p>
                      <div className="space-y-1.5">
                        {recs.slice(0, 5).map((r, i) => (
                          <div key={i} className="flex items-start space-x-2 pl-2 border-l-4 border-black/25">
                            <p className="text-xs text-white leading-snug">{toRecStr(r)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PROJECTED IMPACT â€” full version (expanded) */}
                  {impactEntries.length > 0 && (
                    <div className="px-3.5 py-3">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-2">Projected Impact</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {impactEntries.map(([k, v]) => {
                          const str   = fmtImpact(v);
                          return (
                            <div key={k} className="bg-black/[0.06] border-2 border-black/15 rounded-lg px-2.5 py-2">
                              <p className="text-sm font-bold leading-none text-white">{str}</p>
                              <p className="text-[8px] text-white/60 mt-1 leading-tight">{titleCase(k)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ACTION BUTTONS */}
                  {advisory.actions?.length > 0 && (
                    <div className="px-3.5 py-3">
                      <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-2">Actions</p>
                      <div className="space-y-1.5">
                        {advisory.actions.map(action => {
                          const aType  = action.type || action;
                          const cfg    = ACTION_FORMS[aType];
                          const aClr   = cfg ? COLOR_MAP[cfg.color] : COLOR_MAP.cyan;
                          const isExec = executing === advisory.advisoryId + '-' + aType;
                          return (
                            <button key={aType}
                              onClick={() => openForm(aType, advisory)}
                              disabled={isExec}
                              className={'w-full text-left px-3 py-2.5 rounded-lg border transition-all disabled:opacity-50 flex items-center justify-between group/btn ' + (aClr?.btn || COLOR_MAP.cyan.btn)}>
                              <span className="text-[10px] font-semibold">{cfg?.title || action.label || titleCase(aType)}</span>
                              <span className="text-[10px] opacity-50 font-bold group-hover/btn:opacity-100 group-hover/btn:translate-x-0.5 transition-all">â€º</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {merged.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm font-medium text-white">AI engine analyzing patternsâ€¦</p>
            <p className="text-[10px] text-white/60 mt-1">Advisories will appear here when detected</p>
          </div>
        )}
      </div>
    </div>
  );
}
