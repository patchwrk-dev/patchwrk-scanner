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
providers. Downloading the archive requires network access; scanning does not. Optional
source installation needs registry access unless dependencies are cached. No API keys, provider account or scanner account is needed. Scan stable
checkouts you are authorized to inspect; portable filesystem checks are not an OS
sandbox against hostile concurrent changes. Read [SECURITY.md](SECURITY.md).

## Install and first scan

Use **Node.js 24** and the published [v0.1.0 experimental prerelease](https://github.com/patchwrk-dev/patchwrk-scanner/releases/tag/v0.1.0).
The [README download/verification steps](README.md#download-prebuilt-scanner) are the
primary installation route: download the named archive/checksum, verify, extract into
a new directory and run with Node. No cloning, npm install, pnpm or compilation is
required. macOS/Ubuntu have CLI test coverage; Windows security is unverified.

From the README's `patchwrk-scanner-beta` directory, replace the authorized path:

```sh
node scanner/package/dist/index.js --help
node scanner/package/dist/index.js scan /absolute/path/to/authorized-checkout --html ./report.html
node scanner/package/dist/index.js scan /absolute/path/to/authorized-checkout --json
```

Open the generated report manually. Do not run target installation/build/scripts.
Use the README's [history](README.md#local-scan-history) and
[comparison](README.md#compare-scans) instructions for explicitly saved records.
A valid report can contain affected, unknown or partial findings; it is not a health pass.

## Reproducible scenarios

**Optional contributor/source-checkout scenarios:** use the [source build](README.md#build-from-reviewed-public-source) only if you want the repository fixtures below. These source-only steps are not required for archive users. Run `node scripts/demo.mjs` after that build for the existing synthetic OpenAI example; it parses the fixture without executing it.

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
| Installation | Archive download, checksum, extraction and Node 24 help succeed; note Node/OS and sanitized errors if not. Source tooling is optional. |
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
See [README limitations](README.md#known-limitations).

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
> obtaining the prebuilt archive needs a download and Node 24, with no source build. Test only stable repositories you're
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
