function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toValidationError(publicMessage, details) {
  const err = new Error(publicMessage);
  err.statusCode = 400;
  err.publicMessage = publicMessage;
  err.details = details;
  return err;
}

function validatePriority(priority) {
  const p = Number(priority);
  if (!Number.isInteger(p) || p < 1 || p > 10) {
    throw toValidationError('Invalid priority (must be integer 1-10)', { priority });
  }
  return p;
}

function optionalBenchmarkId(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'benchmarkId')) return null;
  const benchmarkId = body.benchmarkId;
  if (typeof benchmarkId !== 'string' || benchmarkId.length === 0) {
    throw toValidationError('Invalid benchmarkId (string required)', { benchmarkId });
  }
  return benchmarkId;
}

function optionalFailOnce(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'failOnce')) return false;
  if (typeof body.failOnce !== 'boolean') {
    throw toValidationError('Invalid failOnce (boolean required)', { failOnce: body.failOnce });
  }
  return body.failOnce;
}

function withBenchmarkId(payload, body) {
  const benchmarkId = optionalBenchmarkId(body);
  if (benchmarkId) payload.benchmarkId = benchmarkId;
  if (optionalFailOnce(body)) payload.failOnce = true;
  return payload;
}

function validateEmailJob(body) {
  if (!isPlainObject(body)) throw toValidationError('Invalid JSON body', {});
  const { userId, email, subject } = body;
  if (!userId || typeof userId !== 'string') {
    throw toValidationError('Invalid userId (string required)', { userId });
  }
  if (!email || typeof email !== 'string') {
    throw toValidationError('Invalid email (string required)', { email });
  }
  if (!subject || typeof subject !== 'string') {
    throw toValidationError('Invalid subject (string required)', { subject });
  }
  return withBenchmarkId({ userId, email, subject }, body);
}

function validateReportJob(body) {
  if (!isPlainObject(body)) throw toValidationError('Invalid JSON body', {});
  const { reportId, type } = body;
  if (!reportId || typeof reportId !== 'string') {
    throw toValidationError('Invalid reportId (string required)', { reportId });
  }
  if (!type || typeof type !== 'string') {
    throw toValidationError('Invalid type (string required)', { type });
  }
  return withBenchmarkId({ reportId, type }, body);
}

function validateExportJob(body) {
  if (!isPlainObject(body)) throw toValidationError('Invalid JSON body', {});
  const { tableId, format } = body;
  if (!tableId || typeof tableId !== 'string') {
    throw toValidationError('Invalid tableId (string required)', { tableId });
  }
  if (!format || typeof format !== 'string') {
    throw toValidationError('Invalid format (string required)', { format });
  }
  return withBenchmarkId({ tableId, format }, body);
}

module.exports = {
  validatePriority,
  validateEmailJob,
  validateReportJob,
  validateExportJob,
};

