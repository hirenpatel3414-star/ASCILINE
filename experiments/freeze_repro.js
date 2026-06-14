/*
 * freeze_repro2.js — Model the COLD-START freeze (issue #7): audio starts late,
 * so the wall-clock fallback renders ahead, then the master clock snaps back to
 * audioEl.currentTime (~0) and playback freezes until audio catches up.
 *
 * Faithfully simulates: a server feeding frames at fps, a capped jitter buffer,
 * a 60fps render loop, and the app.js master-clock + frame-gate logic — under
 * three clock policies.
 */
function sim({ policy, audioDelayMs }) {
  const fps = 24, rAF = 1000 / 60, DURATION = 6000;
  const buf = [];
  let lastServerFrame = -1, audioStart = null;
  const renderTimes = [];

  for (let t = 0; t <= DURATION; t += rAF) {
    // server feeds frames in real time; jitter buffer caps at 20 (drops oldest)
    const want = Math.floor(t / 1000 * fps);
    while (lastServerFrame < want) buf.push({ time: ++lastServerFrame / fps });
    while (buf.length > 20) buf.shift();

    const audioPlaying = t >= audioDelayMs;
    if (audioPlaying && audioStart === null) audioStart = t;
    const audioCurrent = audioPlaying ? (t - audioStart) / 1000 : 0;
    const wall = t / 1000;

    // ── master clock policy ──
    let master;
    if (policy === 'broken')        master = audioPlaying ? audioCurrent : wall;
    else if (policy === 'guard')    master = (audioPlaying && audioCurrent > 0) ? audioCurrent : wall;
    else if (policy === 'monotonic') {
      // fix: anchor audio so the clock never jumps backward
      if (audioPlaying) {
        if (sim._off === undefined) sim._off = wall - audioCurrent; // capture once
        master = audioCurrent + sim._off;
      } else master = wall;
    }

    // ── frame gate (verbatim from app.js) ──
    if (buf.length) {
      while (buf.length > 1 && buf[0].time < master - 0.1) buf.shift();
      if (buf[0].time <= master + 0.05) { buf.shift(); renderTimes.push(t); }
    }
  }
  delete sim._off;
  const last = renderTimes[renderTimes.length - 1] ?? 0;
  const afterAudio = renderTimes.filter(t => t > audioDelayMs).length;
  const trailingStallMs = Math.round(DURATION - last);   // froze until the end?
  return { rendered: renderTimes.length, afterAudio, trailingStallMs };
}

const EXPECTED_AFTER = Math.round((6000 - 2000) / 1000 * 24); // ~96 frames in the 2-6s window
console.log(`audio starts 2s late (cold start). Expect ~${EXPECTED_AFTER} frames AFTER 2s if smooth:\n`);
for (const policy of ['broken', 'guard', 'monotonic']) {
  const r = sim({ policy, audioDelayMs: 2000 });
  const frozen = r.afterAudio < 5;
  console.log(`  ${policy.padEnd(10)} total ${String(r.rendered).padStart(3)}  | after-audio ${String(r.afterAudio).padStart(3)}/${EXPECTED_AFTER}  | `
    + (frozen ? `FROZE (stuck ${r.trailingStallMs}ms to end)` : `smooth`));
}
