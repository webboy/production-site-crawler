#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from '../config/env.js';
import { registerCrawlCommand } from './crawl.js';
import { registerStatusCommand } from './status.js';

const config = loadConfig();

const program = new Command()
  .name('production-site-crawler')
  .description('Production site crawler CLI')
  .version('0.1.0');

registerCrawlCommand(program, config);
registerStatusCommand(program, config);

await program.parseAsync(process.argv);
