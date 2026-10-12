'use strict';

/*
 * Dev-only helper: evaluate an expression inside a running Bop instance's DevTools target and print
 * the value. Used while reproducing input-level bugs by hand, not by the test suite.
 *
 *   node tools/cdp-eval.js <port> <urlSuffix> "<expression>"
 */

const { evaluate } = require('./cdp.js');

const [, , portArg, suffix, expression] = process.argv;
const port = Number(portArg || 9222);

evaluate(port, suffix, expression)
  .then((value) => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); })
  .catch((error) => { process.stdout.write(`${error.message}\n`); process.exitCode = 1; });
