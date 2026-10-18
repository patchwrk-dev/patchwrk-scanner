# First developer beta testing guide

Preparation for an initial round of **10 consenting external developers**. Nobody
is enrolled or contacted by this document. Participation and feedback are voluntary;
stop or skip a scenario at any time. Do not submit feedback until the founder opens
the round and you choose to participate. No signup, telemetry or automatic upload.

## What you are testing

PatchWRK Scanner is free, MIT-licensed and experimental. It runs locally with
**offline, read-only static analysis** of JavaScript/TypeScript. Supported SDK
identities are Stripe, OpenAI, Anthropic, Shopify and Twilio. Only Stripe/OpenAI
have curated compatibility changes: four narrow historical records. There is no
continuous monitoring, automatic repair or available PatchWRK Cloud service.

Scanning does not execute target code, install target dependencies or contact API
providers. Initial source installation needs registry access unless dependencies
are cached. No API keys, provider account or scanner account is needed. Scan stable
checkouts you are authorized to inspect; portable filesystem checks are not an OS
sandbox against hostile concurrent changes. Read [SECURITY.md](SECURITY.md).

## Install and first scan

Use Git, Node.js **24** and pnpm **11.25.0**. macOS and Ubuntu are CI-tested;
Windows security remains unverified. Commands below assume a macOS/Linux POSIX
shell. See [README.md](README.md#build-from-reviewed-public-source) for prerequisite
installation and full instructions. No npm package or release archive is published.

```sh
node --version
pnpm --version
git clone https://github.com/patchwrk-dev/patchwrk-scanner.git
cd patchwrk-scanner
git rev-parse HEAD
# Review the selected source commit before installing.
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/index.js --help
node scripts/demo.mjs
```

The demo scans an existing synthetic OpenAI example, prints actual terminal/JSON
excerpts and identifies where local raw reports were saved. It does not execute
that example. Raw reports can contain absolute paths; do not upload them unreviewed.

For your own stable, authorized repository, replace the placeholder below. Stay in
the scanner checkout; do not run install/build/scripts inside the scan target.

```sh
node dist/index.js scan /absolute/path/to/authorized-checkout
node dist/index.js scan /absolute/path/to/authorized-checkout --json
node dist/index.js changes --coverage --json
```

## Reproducible scenarios

Materialize three **existing synthetic benchmark cases**, using only Node's file
APIs. This reads their inert source strings; it never imports or executes them.
Run once in a fresh scanner checkout; it refuses to overwrite the scenario directory.

```sh
node --input-type=module <<'NODE'
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const suite = JSON.parse(await readFile('tests/fixtures/benchmark/suite.json', 'utf8'));
const ids = ['multiple-sdks', 'unsupported-dynamic-import', 'stripe-commonjs-legacy-option'];
await mkdir('.cache', { recursive: true });
await mkdir('.cache/beta-scenarios');
for (const id of ids) {
  const example = suite.cases.find(item => item.id === id);
  if (!example) throw new Error('Expected synthetic case missing');
  await mkdir('.cache/beta-scenarios/' + id);
  for (const [name, source] of Object.entries(example.files)) {
    if (!['index.ts', 'index.js', 'index.cjs', 'package.json', 'package-lock.json'].includes(name)) throw new Error('Unexpected fixture path');
    await writeFile('.cache/beta-scenarios/' + id + '/' + name, source);
  }
}
NODE
node dist/index.js scan .cache/beta-scenarios/multiple-sdks --json
node dist/index.js scan .cache/beta-scenarios/unsupported-dynamic-import --json
node dist/index.js scan .cache/beta-scenarios/stripe-commonjs-legacy-option --json
```

| Scenario | Try / observe |
| --- | --- |
| Installation | Frozen install, build and help above succeed; note Node/pnpm/OS and sanitized errors if not. |
| Supported detection | `multiple-sdks` reports all five SDK identities and relative evidence locations. This is a synthetic check, not an accuracy guarantee. |
| Missing detection | `unsupported-dynamic-import` contains a dynamic OpenAI import without a literal SDK import/manifest. No integration is reported; this is a known unsupported miss. Distinguish it from a regression in a supported pattern. |
| Version uncertainty | The OpenAI demo declares 4.0.0 but has no lockfile, so installed version remains unknown. The synthetic Stripe case records 8.0.0 in npm lockfile v3; that metadata does not prove deployed runtime. |
| Compatibility usefulness | Demo model evidence matches text-davinci-003 retirement; Stripe case matches the SDK 8 rename record. Review official sources, unknowns and migration caveats. Decide whether this helps a review, without executing a migration or claiming runtime failure. |
| Readability | Run a scenario with and without `--json`. Compare provider, file/line, recorded/declared versions, change ID, status and coverage warnings. |
| Errors | `node dist/index.js scan ../outside` exits 1 with traversal guidance; `node dist/index.js not-a-command` exits 1 with help guidance. A missing direct path also exits 1. |

Valid reports exit **0 even with findings or partial coverage**. Read
`coverage.complete`, analysis/compatibility coverage, warnings and limitations.
`affected` means conditional applicability to one record, not tested breakage.
`not-affected-by-this-change` is narrow; `unknown` or an empty result is not a pass.
SDK versions, remote API versions and observed model configuration are separate.

Known limits include dynamic imports/wrappers, ambiguous modules, unresolved defaults,
unsupported pnpm/Yarn/Bun lock resolution, incomplete provider catalogs and bounded
traversal/analysis. No production-health, comprehensive security or accuracy guarantee.
See [README limitations](README.md#supported-evidence-and-limitations).

## Optional feedback after the round opens

Use the seven-question [feedback template](FEEDBACK.md#beta-testing-feedback-template).
[Issues](https://github.com/patchwrk-dev/patchwrk-scanner/issues/new/choose) are for
reproducible installation/detection/version/compatibility bugs, provider requests
and scoped features. Existing [Discussions](https://github.com/patchwrk-dev/patchwrk-scanner/discussions)
are for Q&A (questions), General (overall feedback), Ideas (early suggestions) and
Show and tell (voluntary sanitized useful findings). Do not duplicate the same report.
A GitHub account is needed to post there, not to run the scanner.

Posts and GitHub profile identity are public. Use invented minimal examples and
relative paths; never provide API keys, credentials, environment dumps, private source,
customer data or raw sensitive reports. Do not name a private repository. Each answer
is optional; no names, emails, company or repository access is requested. Security
findings go through [SECURITY.md](SECURITY.md), never public Issues/Discussions.

## Invitation draft — not sent

> Would you like to try PatchWRK Scanner in our first small developer testing round?
> It's free and open source, an experimental beta for finding supported API SDK
> evidence and reviewing limited historical compatibility guidance. It scans locally,
> offline and read-only, without executing target code, telemetry or uploads; initial
> installation downloads build dependencies. Test only stable repositories you're
> authorized to inspect, or start with the synthetic demo. There is no continuous
> monitoring or automatic repair. Participation and sanitized feedback are voluntary;
> you can decline, skip questions or stop at any time. Please read the
> [testing guide](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/BETA_TESTING.md)
> and [security policy](https://github.com/patchwrk-dev/patchwrk-scanner/blob/main/SECURITY.md)
> before deciding. No API keys or private source are requested.

Before any outreach or collection, the founder must review this invitation, open
the round, obtain consent to participation, assign feedback/security responders and
confirm handling/retention expectations. Do not create a public tester roster or
claim testers/results exist. Do not promise removal of public posts or their copies.
