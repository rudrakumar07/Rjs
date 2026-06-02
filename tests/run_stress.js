// Master runner for all stress tests
const { execSync } = require('child_process');
const path = require('path');

const parts = [
  'test_stress_part1.js',
  'test_stress_part2.js',
  'test_stress_part3.js'
];

let totalPassed = 0;
let totalFailed = 0;
let allErrors = [];

console.log('========================================');
console.log('   Rjs CRDT Stress Test Suite (18K+)');
console.log('========================================\n');

for (const part of parts) {
  const file = path.join(__dirname, part);
  console.log(`\n--- Running ${part} ---`);
  try {
    const output = execSync(`node "${file}"`, { encoding: 'utf8', timeout: 300000 });
    console.log(output);

    // Parse results
    const passedMatch = output.match(/Passed:\s*(\d+)/);
    const failedMatch = output.match(/Failed:\s*(\d+)/);
    const totalMatch = output.match(/Total:\s*(\d+)/);

    if (passedMatch) totalPassed += parseInt(passedMatch[1]);
    if (failedMatch) totalFailed += parseInt(failedMatch[1]);
  } catch (e) {
    console.log(`ERROR running ${part}:`);
    console.log(e.stdout || e.message);
    totalFailed++;
  }
}

console.log('\n========================================');
console.log('         GRAND TOTAL RESULTS');
console.log('========================================');
console.log(`Total Tests:  ${totalPassed + totalFailed}`);
console.log(`Passed:       ${totalPassed}`);
console.log(`Failed:       ${totalFailed}`);
console.log(`Status:       ${totalFailed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
console.log('========================================');
