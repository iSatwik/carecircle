'use strict';

/**
 * Simple, conservative warning thresholds for home readings.
 * These only decide when to NOTIFY the care circle – they are not a diagnosis.
 */
const LIMITS = Object.freeze({
  systolicHigh: 180,
  diastolicHigh: 110,
  systolicLow: 90,
  sugarLow: 70,
  sugarHigh: 300,
});

/** @returns {string[]} human-readable reasons to alert the circle */
function vitalFlags({ systolic, diastolic, sugar } = {}) {
  const flags = [];
  if (typeof systolic === 'number' && typeof diastolic === 'number') {
    if (systolic >= LIMITS.systolicHigh || diastolic >= LIMITS.diastolicHigh) {
      flags.push(`Very high blood pressure (${systolic}/${diastolic})`);
    } else if (systolic < LIMITS.systolicLow) {
      flags.push(`Low blood pressure (${systolic}/${diastolic})`);
    }
  }
  if (typeof sugar === 'number') {
    if (sugar < LIMITS.sugarLow) flags.push(`Low blood sugar (${sugar} mg/dL)`);
    else if (sugar > LIMITS.sugarHigh) flags.push(`Very high blood sugar (${sugar} mg/dL)`);
  }
  return flags;
}

/**
 * Consecutive days (most recent first) on which every scheduled dose was taken.
 * Today does not break the streak while it is still in progress.
 * @param {{date:string, expected:number, taken:number}[]} daily oldest → newest
 */
function streakFromDaily(daily) {
  let streak = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    const day = daily[i];
    const isToday = i === daily.length - 1;
    if (day.expected === 0) continue;
    if (day.taken === day.expected) streak += 1;
    else if (!isToday) break;
  }
  return streak;
}

module.exports = { LIMITS, vitalFlags, streakFromDaily };
