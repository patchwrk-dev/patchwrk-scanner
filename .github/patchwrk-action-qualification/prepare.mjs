/* global process, console */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
assert.equal(process.platform, 'linux');assert.equal(process.arch, 'x64');assert.equal(process.versions.node.split('.')[0], '24');
const base = await realpath(process.env.GITHUB_WORKSPACE);
const temp = await realpath(process.env.RUNNER_TEMP);
assert.ok(!temp.startsWith(base + path.sep));
const root = path.join(base, 'synthetic');await mkdir(root);await mkdir(path.join(root, 'src'));
const files = {
  'package.json': JSON.stringify({name:'synthetic-inert',dependencies:{stripe:'12.0.0',openai:'4.0.0','@anthropic-ai/sdk':'0.20.0','@shopify/shopify-api':'9.0.0',twilio:'5.0.0'},scripts:{postinstall:'exit 77'}}),
  'src/index.ts': "import Stripe from 'stripe';import OpenAI from 'openai';import Anthropic from '@anthropic-ai/sdk';import {shopifyApi} from '@shopify/shopify-api';import twilio from 'twilio';new Stripe('SYNTHETIC_SENTINEL');new OpenAI({apiKey:'SYNTHETIC_SENTINEL'});new Anthropic();shopifyApi({});twilio();",
  'src/::error::SYNTHETIC_SENTINEL.cjs': `require('node:fs').writeFileSync(${JSON.stringify(path.join(temp,'patchwrk-EXECUTED'))},'bad');throw Error('SYNTHETIC MUST NOT EXECUTE');`,
  '.env': 'TOKEN=SYNTHETIC_SENTINEL'
};
for (const [name,text] of Object.entries(files)) await writeFile(path.join(root,name),text,{flag:'wx',mode:0o600});
const hashes={};for(const name of Object.keys(files))hashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
await writeFile(path.join(temp,'patchwrk-qualification-state.json'),JSON.stringify({hashes}),{flag:'wx',mode:0o600});
console.log('PASS synthetic fixture prepared; no target code executed or dependencies installed');
