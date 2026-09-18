import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../services/socket';
import AlertPanel from './AlertPanel';
import AdvisoryPanel from './AdvisoryPanel';

/* ─── Navigation structure ─────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { path: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4', label: 'Command Centre' },
      { path: '/architecture', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z', label: 'Platform Architecture' },
    ],
  },
  {
    label: 'Asset Performance',
    items: [
      { path: '/registry', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', label: 'Asset Registry' },
      { path: '/health',   icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', label: 'Health Workbench' },
      { path: '/risk',     icon: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01', label: 'Risk Cockpit' },
      { path: '/map',      icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7', label: 'Network Map' },
    ],
  },
  {
    label: 'Reliability',
    items: [
      { path: '/reliability', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z', label: 'Reliability & FMECA' },
      { path: '/models',      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Model Governance' },
    ],
  },
  {
    label: 'Investment Planning',
    items: [
      { path: '/investment', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Investment & Scenarios' },
      { path: '/reporting',  icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Reporting & Analytics' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { path: '/integration', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1', label: 'Integration Console' },
      { path: '/configure',   icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a2 2 0 012 2v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a2 2 0 01-2 2h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a2 2 0 01-2-2v-3a1 1 0 011-1h1a2 2 0 100-4H6a1 1 0 01-1-1V8a2 2 0 012-2h3a1 1 0 001-1V4z', label: 'Configuration Studio' },
      { path: '/security',    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', label: 'Security & Administration' },
      { path: '/services',    icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z', label: 'Managed Services' },
    ],
  },
];

/* ─── Deep search index  ──────────────────────────────────
   Each entry: { label, path, breadcrumb, keywords, icon }
   breadcrumb = ['Page', 'Section', 'Item']  (shown in results)
   keywords   = extra words matched against (not displayed)
────────────────────────────────────────────────────────── */
const SEARCH_INDEX = [
  /* Command Centre */
  { label:'Command Centre',        path:'/',           breadcrumb:['Command Centre'],                    icon:'BAR',   keywords:'overview executive fleet dashboard home kpi summary' },
  { label:'Fleet Health Index',    path:'/',           breadcrumb:['Command Centre','Indices'],          icon:'BAR',   keywords:'ahi mean fleet health index score condition' },
  { label:'Risk Exposure',         path:'/',           breadcrumb:['Command Centre','Indices'],          icon:'BOLT',  keywords:'ari risk exposure crore annualised expected loss rupees' },
  { label:'Health Distribution',   path:'/',           breadcrumb:['Command Centre','Distribution'],     icon:'BAR',   keywords:'bands excellent good fair poor critical distribution doughnut' },
  { label:'Zone Risk',             path:'/',           breadcrumb:['Command Centre','Zones'],            icon:'MAP',   keywords:'zone dharavi bandra andheri borivali chembur mulund risk concentration' },

  /* Registry */
  { label:'Asset Registry',        path:'/registry',   breadcrumb:['Asset Registry'],                    icon:'BOX',   keywords:'assets register hierarchy transformer breaker rmu search filter' },
  { label:'Asset Hierarchy',       path:'/registry',   breadcrumb:['Asset Registry','Hierarchy'],        icon:'BOX',   keywords:'transformer bay feeder rmu consumer parent child tree relationships' },
  { label:'Bulk Upload',           path:'/registry',   breadcrumb:['Asset Registry','Bulk Upload'],      icon:'BOX',   keywords:'bulk upload csv xlsx import template validation staged' },
  { label:'Asset Attributes',      path:'/registry',   breadcrumb:['Asset Registry','Attributes'],       icon:'CLIP',  keywords:'attributes make rating commissioned lifecycle custom fields redundancy' },

  /* Health */
  { label:'Health Workbench',      path:'/health',     breadcrumb:['Health Workbench'],                  icon:'BOLT',  keywords:'ahi health index condition dga oil temperature loading partial discharge' },
  { label:'Health Model Config',   path:'/health',     breadcrumb:['Health Workbench','Configurator'],   icon:'COG',   keywords:'weights threshold configure model tuning parameters bands weighting' },
  { label:'Criticality Index',     path:'/health',     breadcrumb:['Health Workbench','Criticality'],    icon:'BOLT',  keywords:'aci criticality consumer revenue reliability safety environment impact' },
  { label:'Remaining Useful Life', path:'/health',     breadcrumb:['Health Workbench','Predictive'],     icon:'TREND', keywords:'rul remaining useful life prediction confidence forecast ageing' },
  { label:'Explainable AI',        path:'/health',     breadcrumb:['Health Workbench','Predictive'],     icon:'TREND', keywords:'xai explainability feature contribution glass box rationale supporting logic' },

  /* Risk */
  { label:'Risk Cockpit',          path:'/risk',       breadcrumb:['Risk Cockpit'],                      icon:'BOLT',  keywords:'ari risk pof cof probability consequence failure monetised weibull' },
  { label:'Risk Heat Map',         path:'/risk',       breadcrumb:['Risk Cockpit','Heat Map'],           icon:'BAR',   keywords:'heat map matrix probability consequence grid enterprise' },
  { label:'Risk Register',         path:'/risk',       breadcrumb:['Risk Cockpit','Register'],           icon:'CLIP',  keywords:'register ranking top assets highest risk ranked exposure' },

  /* Investment */
  { label:'Investment Planning',   path:'/investment', breadcrumb:['Investment Planning'],               icon:'COIN',  keywords:'aip capex opex portfolio optimisation budget investment value score ivs' },
  { label:'Scenario Lab',          path:'/investment', breadcrumb:['Investment Planning','Scenarios'],   icon:'TREND', keywords:'scenario budget reduced increased reliability target risk replacement baseline' },
  { label:'Regulatory & ARR',      path:'/investment', breadcrumb:['Investment Planning','Regulatory'],  icon:'CLIP',  keywords:'arr tariff wheeling regulatory justification merc submission revenue requirement' },

  /* Map */
  { label:'Network Map',           path:'/map',        breadcrumb:['Network Map'],                       icon:'MAP',   keywords:'gis map geographic substations risk heat failure impact radius leaflet' },

  /* Platform Architecture - Section A */
  { label:'Platform Architecture', path:'/architecture', breadcrumb:['Platform Architecture'],           icon:'BOX',   keywords:'architecture solution platform aveva saap layers cots technology stack cloud deployment topology' },
  { label:'Technology Stack',      path:'/architecture', breadcrumb:['Platform Architecture','Stack'],   icon:'BOX',   keywords:'technology stack components dependencies standards iso iec versions libraries' },
  { label:'Cloud Architecture',    path:'/architecture', breadcrumb:['Platform Architecture','Cloud'],   icon:'GLOBE', keywords:'cloud deployment vnet azure aws india resident saas hosting subnet topology' },
  { label:'High Availability',     path:'/architecture', breadcrumb:['Platform Architecture','Cloud'],   icon:'SHIELD',keywords:'high availability redundancy failover rpo rto disaster recovery uptime sla 99.5' },
  { label:'Scalability',           path:'/architecture', breadcrumb:['Platform Architecture','Scale'],   icon:'TREND', keywords:'scalability horizontal vertical scaling capacity volumetrics throughput 20000 gb ingest rate' },
  { label:'Data Processing',       path:'/architecture', breadcrumb:['Platform Architecture','Scale'],   icon:'SIGNAL',keywords:'real time batch near real time streaming micro batch latency processing framework' },
  { label:'API Framework',         path:'/architecture', breadcrumb:['Platform Architecture','API'],     icon:'LINK',  keywords:'api framework rest endpoints catalogue openapi versioning authentication error codes' },

  /* Model Governance - Section F */
  { label:'Model Governance',      path:'/models',      breadcrumb:['Model Governance'],                 icon:'BAR',   keywords:'model governance ml ai registry training retraining drift accuracy explainability glass box' },
  { label:'Model Registry',        path:'/models',      breadcrumb:['Model Governance','Registry'],      icon:'BAR',   keywords:'model registry version algorithm features acceptance threshold production candidate' },
  { label:'Training & Evaluation', path:'/models',      breadcrumb:['Model Governance','Training'],      icon:'TREND', keywords:'training holdout split mae rmse r2 evaluation accuracy benchmark overfit generalisation promotion gate' },
  { label:'Drift Detection',       path:'/models',      breadcrumb:['Model Governance','Drift'],         icon:'RECYCLE',keywords:'drift psi population stability index retraining trigger distribution shift baseline' },
  { label:'Anomaly Detection',     path:'/models',      breadcrumb:['Model Governance','Anomaly'],       icon:'ALERT', keywords:'anomaly detection outlier z score mad robust cohort early warning dga partial discharge' },
  { label:'Model Feedback Loop',   path:'/models',      breadcrumb:['Model Governance','Feedback'],      icon:'PEOPLE',keywords:'feedback loop engineer review confirm reject agreement precision labelled data retraining' },

  /* Reliability - Section G */
  { label:'Reliability & FMECA',   path:'/reliability',breadcrumb:['Reliability'],                       icon:'COG',   keywords:'rcm fmeca reliability failure mode effects criticality analysis rpn severity occurrence detection' },
  { label:'Failure Mode Analysis', path:'/reliability',breadcrumb:['Reliability','FMECA'],               icon:'COG',   keywords:'fmeca rpn risk priority number failure mode severity occurrence detection iso 14224' },
  { label:'Maintenance Strategy',  path:'/reliability',breadcrumb:['Reliability','Strategy'],            icon:'WRENCH',keywords:'rcm strategy cbm pdm tbm run to failure iec 60300 maintenance selection' },
  { label:'Interval Optimisation', path:'/reliability',breadcrumb:['Reliability','Intervals'],           icon:'CLOCK', keywords:'inspection interval optimisation overdue maintenance schedule frequency months' },
  { label:'Work Order',            path:'/reliability',breadcrumb:['Reliability','Work Order'],          icon:'WRENCH',keywords:'work order sap pm notification maintenance order raise task list' },

  /* Reporting - Section P */
  { label:'Reporting & Analytics', path:'/reporting',  breadcrumb:['Reporting'],                         icon:'CLIP',  keywords:'report reporting analytics export excel pdf csv download standard ad hoc scheduled' },
  { label:'Report Library',        path:'/reporting',  breadcrumb:['Reporting','Library'],               icon:'CLIP',  keywords:'standard reports fleet health register risk exposure portfolio deferred zone maintenance' },
  { label:'Ad-hoc Report Builder', path:'/reporting',  breadcrumb:['Reporting','Ad-hoc'],                icon:'CLIP',  keywords:'ad hoc builder custom report columns filters sort save definition no code' },
  { label:'Scheduled Reports',     path:'/reporting',  breadcrumb:['Reporting','Scheduling'],            icon:'CLOCK', keywords:'schedule scheduled distribution recipients email daily weekly monthly quarterly' },
  { label:'Regulatory Pack',       path:'/reporting',  breadcrumb:['Reporting','Regulatory'],            icon:'CLIP',  keywords:'regulatory merc arr submission pack tariff cea reliability statement audit trail' },

  /* Integration - Section M */
  { label:'Integration Console',   path:'/integration',breadcrumb:['Integration'],                       icon:'LINK',  keywords:'integration sap gdh gis scada adms cyme historian api gateway ingest interface' },
  { label:'Interface Catalogue',   path:'/integration',breadcrumb:['Integration','Catalogue'],           icon:'LINK',  keywords:'interfaces catalogue systems sap pm mm fico gdh gis scada adms protocol' },
  { label:'Field Mapping',         path:'/integration',breadcrumb:['Integration','Mapping'],             icon:'LINK',  keywords:'field mapping transformation source target validation rules data dictionary' },
  { label:'Work Order Push',       path:'/integration',breadcrumb:['Integration','SAP PM'],              icon:'WRENCH',keywords:'sap pm work order push bapi create notification order number payload' },

  /* Configuration - Section O */
  { label:'Configuration Studio',  path:'/configure',  breadcrumb:['Configuration'],                     icon:'COG',   keywords:'configuration configure no code asset class health model dashboard business rule alarm' },
  { label:'Asset Class Builder',   path:'/configure',  breadcrumb:['Configuration','Asset Classes'],     icon:'BOX',   keywords:'asset class create new type attributes design life voltage custom' },
  { label:'Health Model Builder',  path:'/configure',  breadcrumb:['Configuration','Health Models'],     icon:'COG',   keywords:'health model weights configure parameters live apply preview cohort' },
  { label:'Business Rules',        path:'/configure',  breadcrumb:['Configuration','Rules'],             icon:'COG',   keywords:'business rule builder condition action trigger threshold workflow no code' },
  { label:'Alarm Configuration',   path:'/configure',  breadcrumb:['Configuration','Alarms'],            icon:'BOLT',  keywords:'alarm threshold notification severity escalation configure trigger' },

  /* Security - Section N */
  { label:'Security & Administration', path:'/security', breadcrumb:['Security'],                        icon:'LOCK',  keywords:'security administration rbac role access control user audit trail encryption vapt iso 27001' },
  { label:'Role-Based Access',     path:'/security',   breadcrumb:['Security','Roles'],                  icon:'LOCK',  keywords:'rbac role permission administrator planner engineer auditor least privilege switch' },
  { label:'User Administration',   path:'/security',   breadcrumb:['Security','Users'],                  icon:'PEOPLE',keywords:'user administration create account identity active directory sso mfa provisioning' },
  { label:'Audit Trail',           path:'/security',   breadcrumb:['Security','Audit'],                  icon:'CLIP',  keywords:'audit trail log who what when change history compliance forensic retention' },

  /* Managed Services - Section Q */
  { label:'Managed Services',      path:'/services',   breadcrumb:['Managed Services'],                  icon:'PHONE', keywords:'managed services support incident sla ticket helpdesk hypercare patch knowledge transfer' },
  { label:'Incident Queue',        path:'/services',   breadcrumb:['Managed Services','Incidents'],      icon:'ALERT', keywords:'incident ticket raise severity p1 p2 p3 p4 queue escalation service desk' },
  { label:'SLA Schedule',          path:'/services',   breadcrumb:['Managed Services','SLA'],            icon:'CLOCK', keywords:'sla service level agreement response resolution target availability compliance breach mttr' },
  { label:'Patch Management',      path:'/services',   breadcrumb:['Managed Services','Release'],        icon:'RECYCLE',keywords:'patch release upgrade version cve security maintenance window cadence cab' },
  { label:'Hypercare',             path:'/services',   breadcrumb:['Managed Services','Hypercare'],      icon:'CHECK', keywords:'hypercare go live 90 day window exit criteria embedded team arrival rate' },
  { label:'Knowledge Transfer',    path:'/services',   breadcrumb:['Managed Services','Knowledge'],      icon:'PEOPLE',keywords:'knowledge transfer training tracks sessions attendees sign off exit artefacts handover' },
];

/* ─── Icon helper ──────────────────────────────────────── */
function SvgIcon({ d, size = 'w-4 h-4', strokeWidth = 1.6 }) {
  return (
    <svg className={`${size} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
    </svg>
  );
}

/* Maps the legacy emoji icon keys in SEARCH_INDEX to SVG path strings */
const SEARCH_ICON_PATHS = {
  BAR:   'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  BOLT:  'M13 10V3L4 14h7v7l9-11h-7z',
  BOX:   'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  MAP:   'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  CLIP:  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  COG:   'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  COIN:  'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  TREND: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  WRENCH:  'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  CLOCK:   'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  LINK:    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  LOCK:    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  PEOPLE:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  PHONE:   'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  RECYCLE: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  ALERT:   'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  CHECK:   'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  GLOBE:   'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z',
  SHIELD:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  SIGNAL:  'M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16',
};


/* ─── Page title map ───────────────────────────────────── */
const PAGE_TITLES = {
  '/':           'Command Centre',
  '/registry':   'Asset Registry',
  '/health':     'Health Workbench',
  '/risk':       'Risk Cockpit',
  '/investment': 'Investment Planning',
  '/map':        'Network Map',
  '/architecture':'Platform Architecture',
  '/reliability':'Reliability & Maintenance',
  '/models':     'Model Governance',
  '/reporting':  'Reporting & Analytics',
  '/integration':'Integration Console',
  '/configure':  'Configuration Studio',
  '/security':   'Security & Administration',
  '/services':   'Managed Services',
};

export default function Layout({ children, user, onLogout, theme = 'dark', onThemeToggle }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { alerts, advisories } = useData();
  const [showAlerts,   setShowAlerts]   = useState(false);
  const [showAdvisory, setShowAdvisory] = useState(false);
  const [showProfile,  setShowProfile]  = useState(false);
  const [time,         setTime]         = useState(new Date());
  const [sidebarOpen,  setSidebarOpen]  = useState(
    () => (typeof window === 'undefined' ? true : window.innerWidth > 860)
  );
  const [searchQuery,  setSearchQuery]  = useState('');
  const [showSearch,   setShowSearch]   = useState(false);
  const profileRef   = React.useRef(null);
  const searchRef    = useRef(null);
  const searchInputRef = useRef(null);

  /* Checkpoint H.7 — the rail collapses to icons below the tablet breakpoint so
     the analysis panels get the full width. A user who opens it by hand on a
     narrow screen keeps it open until the viewport crosses the boundary again. */
  useEffect(() => {
    let wasNarrow = window.innerWidth <= 860;
    const onResize = () => {
      const isNarrow = window.innerWidth <= 860;
      if (isNarrow !== wasNarrow) {
        wasNarrow = isNarrow;
        setSidebarOpen(!isNarrow);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearch(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!showSearch) return undefined;
    const onDocClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSearch]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const scored = SEARCH_INDEX.map(item => {
      const haystack = [
        item.label,
        ...(item.breadcrumb || []),
        item.keywords || '',
      ].join(' ').toLowerCase();
      const matchCount = words.filter(w => haystack.includes(w)).length;
      return { item, matchCount };
    }).filter(({ matchCount }) => matchCount > 0);
    scored.sort((a, b) => {
      // Prioritise full-word matches in label, then match count
      const aLabel = a.item.label.toLowerCase().includes(q) ? 1 : 0;
      const bLabel = b.item.label.toLowerCase().includes(q) ? 1 : 0;
      if (bLabel !== aLabel) return bLabel - aLabel;
      return b.matchCount - a.matchCount;
    });
    return scored.slice(0, 10).map(({ item }) => item);
  }, [searchQuery]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!showProfile) return undefined;
    const onDocClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setShowProfile(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showProfile]);

  const unacknowledgedAlerts = alerts?.filter(a => !a.acknowledged)?.length || 0;
  const criticalAlerts       = alerts?.filter(a => a.type === 'critical' && !a.acknowledged)?.length || 0;
  const pageTitle            = PAGE_TITLES[location.pathname] || 'Dashboard';

  return (
    <div className={`theme-${theme} h-screen w-screen flex overflow-hidden bg-app-darker`}>

      {/* ── SIDEBAR ──────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 overflow-hidden transition-all duration-200 bg-app-dark border-r border-app-border"
        style={{ width: sidebarOpen ? 'var(--app-sidebar-w, 244px)' : '60px' }}
      >
        {/* Logo row */}
        <div
          className="flex items-center px-3 cursor-pointer shrink-0 border-b border-app-border"
          style={{ height: 'var(--app-header-h, 62px)' }}
          onClick={() => navigate('/')}
        >
          {/* Partner lockup ships on an opaque white background, so it sits on a
              white card rather than directly on the dark sidebar. Collapsed to
              the icon rail there is no room to keep it legible, so it hides —
              matching how nav labels already hide in that state. */}
          {sidebarOpen && (
            <div style={{
              width: '100%',
              background: '#fff',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <img
                src="/partner-logo.png"
                alt="AVEVA / Schneider Electric"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              {sidebarOpen && (
                <p className="nav-section-label">{section.label}</p>
              )}
              {!sidebarOpen && <div className="h-3" />}
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <div key={item.path} className="px-2">
                    <button
                      onClick={() => navigate(item.path)}
                      className={`nav-item w-full ${isActive ? 'active' : ''}`}
                      title={!sidebarOpen ? item.label : undefined}
                    >
                      <SvgIcon d={item.icon} />
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div className="shrink-0 border-t border-app-border">
          {sidebarOpen && (
            <div className="flex items-center gap-3 px-4 py-3">
              <div
                className="w-8 h-8 rounded-lg bg-app-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              >
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate" style={{ color: 'var(--app-text)' }}>{user?.fullName}</div>
                <div className="text-[10px] truncate capitalize" style={{ color: 'var(--app-text-faint)' }}>
                  {user?.role?.replace('_', ' ')}
                </div>
              </div>
            </div>
          )}
          <div className="px-2 pb-3" />
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── TOPBAR ──────────────────────────────────────────── */}
        <header
          className="shrink-0 flex items-center gap-3 px-4 border-b border-app-border"
          style={{ height: 'var(--app-header-h, 62px)', background: 'var(--app-chrome-bg)' }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="icon-btn"
            title="Toggle sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* App Command Center title */}
          <div className="hidden sm:flex flex-col ml-1">
            <span className="text-[11px] font-bold tracking-widest" style={{ color: 'var(--app-text)', letterSpacing: '0.10em' }}>APP COMMAND CENTER</span>
            <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{pageTitle}</span>
          </div>

          {/* Search */}
          <div className="header-search flex-1 max-w-xs ml-3" ref={searchRef} style={{ position: 'relative' }}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--app-text-faint)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search anything… (Ctrl+K)"
              aria-label="Search"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); }}
              onFocus={() => setShowSearch(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); e.target.blur(); }
                if (e.key === 'Enter' && searchResults.length > 0) {
                  navigate(searchResults[0].path);
                  setShowSearch(false);
                  setSearchQuery('');
                  e.target.blur();
                }
              }}
            />
            {showSearch && searchQuery.trim() && (
              <div className="search-dropdown">
                {searchResults.length === 0 ? (
                  <div className="search-dropdown-empty">No results for "{searchQuery}"</div>
                ) : searchResults.map((item, idx) => (
                  <button
                    key={idx}
                    className="search-dropdown-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigate(item.path);
                      setShowSearch(false);
                      setSearchQuery('');
                    }}
                  >
                    <div className="sdi-icon"><SvgIcon d={SEARCH_ICON_PATHS[item.icon] || item.icon} size="w-3.5 h-3.5" /></div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="sdi-label">{item.label}</div>
                      <div className="sdi-desc">
                        {item.breadcrumb.join(' › ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Live time */}
          <div className="hidden md:block font-mono text-xs px-2 py-1 rounded-md"
            style={{ background: 'var(--app-surface-soft)', color: 'var(--app-text-muted)', border: '1px solid var(--app-border)', letterSpacing: '0.04em' }}>
            {time.toLocaleTimeString('en-LK', { hour12: false })}
          </div>

          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            className="icon-btn"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="-1 -1 26 26">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1012 21a8.962 8.962 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* AI Advisory — wider purple action button */}
          <button
            onClick={() => { setShowAdvisory(!showAdvisory); setShowAlerts(false); }}
            className={`app-advisory-btn ${showAdvisory ? 'active' : ''}`}
            title="AI Advisory"
            aria-label="AI Advisory"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>AI Advisory</span>
          </button>

          {/* Alerts bell */}
          <button
            onClick={() => { setShowAlerts(!showAlerts); setShowAdvisory(false); }}
            className={`icon-btn ${showAlerts ? 'active' : ''}`}
            title="Alerts"
            aria-label="Alerts"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unacknowledgedAlerts > 0 && (
              <span
                className={`absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] flex items-center justify-center font-bold px-0.5 ${criticalAlerts > 0 ? 'animate-pulse' : ''}`}
                style={{
                  background: criticalAlerts > 0 ? 'var(--app-danger)' : 'var(--app-warning)',
                  color: 'var(--app-on-color)',
                }}
              >
                {unacknowledgedAlerts}
              </span>
            )}
          </button>

          {/* User avatar — icon only with dropdown menu */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setShowProfile((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={showProfile}
              title={user?.fullName || 'Account'}
            >
              {user?.fullName?.charAt(0) || 'U'}
            </button>
            {showProfile && (
              <div className="profile-menu" role="menu">
                <div className="profile-menu-header">
                  <div className="avatar">{user?.fullName?.charAt(0) || 'U'}</div>
                  <div className="min-w-0">
                    <div className="name truncate">{user?.fullName || 'Account'}</div>
                    <div className="status">Online</div>
                  </div>
                </div>
                <div className="profile-menu-section">
                  <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); navigate('/profile'); }}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                    Profile
                  </button>
                  <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); setShowAlerts(true); setShowAdvisory(false); }}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
                    Notification
                  </button>
                  <button className="profile-menu-item" role="menuitem" onClick={() => { setShowProfile(false); onThemeToggle && onThemeToggle(); }}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    Settings
                  </button>
                </div>
                <div className="profile-menu-section">
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── CONTENT ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          <main className={`h-full ${location.pathname === '/map' ? 'overflow-hidden' : 'overflow-auto p-4'}`}>
            {children}
          </main>
        </div>
      </div>

      {/* Alert panel — rendered outside flex flow, true fixed overlay */}
      {showAlerts && (
        <div className="w-80 overflow-hidden animate-slide-up border-l border-app-border bg-app-darker"
          style={{ position: 'fixed', top: 'var(--app-header-h, 62px)', right: 0, bottom: 0, zIndex: 200 }}>
          <AlertPanel alerts={alerts} onClose={() => setShowAlerts(false)} />
        </div>
      )}

      {/* AI Advisory panel — rendered outside flex flow, true fixed overlay */}
      {showAdvisory && (
        <div className="app-advisory-panel w-96 overflow-hidden animate-slide-up border-2 border-app-border"
          style={{ position: 'fixed', top: 'var(--app-header-h, 62px)', right: 0, bottom: 0, zIndex: 200 }}>
          <AdvisoryPanel advisories={advisories} onClose={() => setShowAdvisory(false)} />
        </div>
      )}
    </div>
  );
}

