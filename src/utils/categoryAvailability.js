// Category availability = manual toggle (master switch) + optional daily time
// windows. Manual OFF always wins; when ON, one or more schedules (if any)
// decide live availability. No schedules + enabled = always available.

const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Minutes since midnight, in Asia/Kolkata — the app's single operating timezone.
function nowMinutesIST() {
  const [hh, mm] = IST_TIME_FORMATTER.format(new Date()).split(":").map(Number);
  return hh * 60 + mm;
}

function toMinutes(hhmm) {
  const [hh, mm] = String(hhmm).split(":").map(Number);
  return hh * 60 + mm;
}

function isWithinWindow(nowMin, startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === end) return true; // 24h window
  if (start < end) return nowMin >= start && nowMin < end;
  return nowMin >= start || nowMin < end; // wraps past midnight
}

// categoryDoc: a MenuCategory document (or null/undefined if none exists yet
// for this restaurant+category — defaults to enabled, no schedule, i.e. always on).
function isCategoryAvailableNow(categoryDoc) {
  if (!categoryDoc) return true;
  if (categoryDoc.isEnabled === false) return false;
  if (!categoryDoc.schedules || categoryDoc.schedules.length === 0) return true;
  const nowMin = nowMinutesIST();
  return categoryDoc.schedules.some((w) => isWithinWindow(nowMin, w.startTime, w.endTime));
}

function categoryAvailabilityInfo(categoryDoc) {
  return {
    isEnabled: categoryDoc?.isEnabled !== false,
    schedules: categoryDoc?.schedules || [],
    isAvailableNow: isCategoryAvailableNow(categoryDoc),
  };
}

module.exports = { isCategoryAvailableNow, categoryAvailabilityInfo, nowMinutesIST, isWithinWindow };
