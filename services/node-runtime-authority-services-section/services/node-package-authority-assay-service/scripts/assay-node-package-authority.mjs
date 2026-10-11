#!/usr/bin/env node
import process from "node:process";
import { assayNodePackageAuthority } from "../src/assay-package-authority.mjs";

const enforce = process.argv.includes("--enforce");
const root = process.argv.find((value, index) => index > 1 && value !== "--enforce") ?? process.cwd();
const report = await assayNodePackageAuthority(root);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (enforce && report.conflicts.length > 0) process.exitCode = 1;
