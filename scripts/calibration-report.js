#!/usr/bin/env node
// Prints the calibration study for every built-in model: does a forecast of
// X% come true X% of the time in a simulated population?
//   npm run calibrate

import { validateModel } from '../src/engine/core.js';
import { LIBRARY } from '../src/engine/library.js';
import { calibrationStudy, tuneDependence } from '../src/engine/calibration.js';

const n = Number(process.argv[2]) || 20000;
const f = (x, d = 3) => x.toFixed(d);
console.log(`Calibration study · ${n.toLocaleString()} simulated people per model (held-out seed)\n`);
console.log('model       overlap  tuned ρ │ calib. error  Oracle  naive │ log loss  Oracle  naive   base │ Brier  Oracle  naive   base');
console.log('─'.repeat(122));
for (const raw of LIBRARY) {
  const model = tuneDependence(validateModel(raw));
  const s = calibrationStudy(model, { n, overlap: model.overlap, seed: 31337 });
  console.log(
    `${raw.id.padEnd(11)} ${f(model.overlap, 2).padStart(7)}  ${f(model.dependence, 2).padStart(7)} │ ${' '.repeat(13)}${(f(s.oracle.ece * 100, 1) + '%').padStart(6)} ${(f(s.naive.ece * 100, 1) + '%').padStart(6)} │ ${' '.repeat(9)}${f(s.oracle.logLoss).padStart(6)} ${f(s.naive.logLoss).padStart(6)} ${f(s.baseRate.logLoss).padStart(6)} │ ${' '.repeat(6)}${f(s.oracle.brier).padStart(6)} ${f(s.naive.brier).padStart(6)} ${f(s.baseRate.brier).padStart(6)}`,
  );
}
