const LIMIT_NOTICE =
  "Repository capture evidence limit reached; some observations were omitted.";
const size = (value) => Buffer.byteLength(JSON.stringify(value));

// Bound the whole serialized sidecar, including metadata and explanatory notices.
// No diff is partially truncated: an item either fits intact or is omitted.
export function boundRepositoryRecord(record, { maxBytes = 4000000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256)
    throw Error("Invalid repository record budget");
  const result = {};
  for (const key of ["sessionId", "seq", "callId", "rootCallId", "capturedAt"])
    if (record[key] !== undefined) result[key] = structuredClone(record[key]);
  result.observations = [];
  result.notices = [LIMIT_NOTICE]; // Reserve omission notice before accepting data.
  let bytes = size(result),
    omitted = false,
    items = 0;
  if (bytes > maxBytes)
    throw Error("Repository capture identity exceeds record budget");
  function append(array, item) {
    const encoded = JSON.stringify(item);
    const cost = Buffer.byteLength(encoded) + Number(array.length > 0);
    if (bytes + cost > maxBytes) {
      omitted = true;
      return false;
    }
    array.push(JSON.parse(encoded));
    bytes += cost;
    return true;
  }
  const notices = (input, target) => {
    for (const text of input ?? []) {
      if (typeof text !== "string") {
        omitted = true;
        continue;
      }
      if (target.length >= 32) {
        omitted = true;
        break;
      }
      if (text.length > 500) omitted = true;
      if (!append(target, text.slice(0, 500))) break;
    }
  };
  notices(record.notices, result.notices);
  for (const observed of record.observations ?? []) {
    if (result.observations.length >= 8) {
      omitted = true;
      break;
    }
    const row = { hunks: [], files: [], notices: [] };
    for (const key of ["root", "repositoryId", "capturedAt"])
      if (observed[key] !== undefined) row[key] = observed[key];
    if (!append(result.observations, row)) break;
    const admitted = result.observations.at(-1);
    notices(observed.notices, admitted.notices);
    for (const field of ["hunks", "files"]) {
      for (const item of observed[field] ?? []) {
        if (items >= 1000) {
          omitted = true;
          break;
        }
        items++;
        // Unlike the old aggregate bound, a large item need not hide later small items.
        append(admitted[field], item);
      }
    }
  }
  if (!omitted) result.notices.shift();
  return result;
}
