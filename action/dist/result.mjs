// action/src/result.ts
var providers = ["stripe", "openai", "anthropic", "shopify", "twilio"];
var statuses = ["affected", "potentially-affected", "not-affected-by-this-change", "unknown"];
function minimize(report) {
  const complete = report.coverage.complete && report.analysis?.complete === true && report.compatibility.coverage.complete;
  const discoveries = Object.fromEntries(providers.map((provider) => [provider, report.integrations.filter((i) => i.provider === provider).length]));
  const counts = Object.fromEntries(statuses.map((status) => [status, report.compatibility.assessments.filter((a) => a.status === status).length]));
  const findings = report.compatibility.assessments.map((a) => {
    if (!providers.some((p) => p === a.provider) || !statuses.includes(a.status) || !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(a.changeId)) throw Error("Invalid result");
    return { provider: a.provider, changeId: a.changeId, status: a.status };
  });
  const groups = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const key = JSON.stringify(f), previous = groups.get(key);
    groups.set(key, { ...f, count: (previous?.count ?? 0) + 1 });
  }
  if (typeof report.compatibility.catalogVersion !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(report.compatibility.catalogVersion)) throw Error("Invalid catalog version");
  return {
    schemaVersion: 1,
    engineCommit: "8fa08313e65b4d313460936e606d2f3f92979c16",
    catalogVersion: report.compatibility.catalogVersion,
    status: complete ? "complete" : "partial",
    discoveries,
    counts,
    findings: [...groups.values()],
    filesScanned: report.coverage.filesScanned,
    catalogRecords: report.compatibility.catalogRecordCount,
    coverage: {
      discovery: report.coverage.complete,
      analysis: report.analysis?.complete === true,
      compatibility: report.compatibility.coverage.complete,
      truncated: report.compatibility.coverage.assessmentsTruncated || report.compatibility.coverage.evidenceDisplayTruncated
    },
    limitations: [
      "Static evidence only; not a compatibility or production-health guarantee.",
      "Five-family discovery; four historical Stripe/OpenAI catalog records.",
      "No locations, source, credentials or raw diagnostics in this minimized output."
    ]
  };
}
export {
  minimize
};
