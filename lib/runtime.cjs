const path = require('path');
const { execFileSync } = require('child_process');

function elapsedSeconds(value) {
  const match = String(value).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}
function detectRuntime(appRoot) {
  const executable = path.resolve(appRoot, '../../MacOS/Devin');
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding:'utf8', timeout:3000 }).split('\n');
    const matches = rows.map(row => row.match(/^\s*(\d+)\s+(.+)$/)).filter(m => m && m[2] === executable);
    if (!matches.length) return { kind:'not-running' };
    if (matches.length !== 1) return { kind:'unknown', reason:'multiple-main-processes' };
    const pid = Number(matches[0][1]);
    const info = execFileSync('/bin/ps', ['-p',String(pid),'-o','lstart=','-o','etime='], { encoding:'utf8',timeout:3000,env:{...process.env,LC_ALL:'C'} }).trim();
    const fields = info.match(/^(.*?)\s+([\d:-]+)$/);
    const elapsed = fields && elapsedSeconds(fields[2]);
    if (!fields || elapsed === null) return {kind:'unknown',reason:'unreadable-process-start'};
    return { kind:'running', pid, id:pid+'|'+fields[1].replace(/\s+/g,' '), startedAt:new Date(Date.now()-elapsed*1000).toISOString() };
  } catch (_) { return {kind:'unknown',reason:'process-start-unavailable'}; }
}
function readiness(record, runtime) {
  if (!record) return {state:'unpatched',reloadRequired:false,runtime};
  if (runtime.kind === 'not-running') return {state:'prepared',reloadRequired:false,runtime};
  if (!runtime.id || !runtime.startedAt) return {state:'restart-unverified',reloadRequired:true,runtime};
  const patchedAt = Date.parse(record.lastPatchedAt || record.installedAt);
  const startedAt = Date.parse(runtime.startedAt);
  if (!Number.isFinite(patchedAt) || !Number.isFinite(startedAt)) return {state:'restart-unverified',reloadRequired:true,runtime};
  const pending = record.appliedRuntime?.id ? record.appliedRuntime.id === runtime.id : patchedAt >= startedAt - 1500;
  return {state:pending?'pending-restart':'healthy',reloadRequired:pending,runtime,restartCompleted:!pending};
}
module.exports={detectRuntime,readiness,elapsedSeconds};
