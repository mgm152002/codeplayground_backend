const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const AWS = require('aws-sdk');
const client = require('prom-client');

require('aws-sdk/lib/maintenance_mode_message').suppress = true;
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 8000);

const BUCKET_NAME = process.env.S3_BUCKET || 'codeplayground-bucket';
const API_KEY = process.env.API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost:3000';
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || 'codeplayground';
const MAX_CODE_BYTES = 50_000;
const MAX_STDIN_BYTES = 10_000;
const MAX_PROMPT_BYTES = 3_000;
const MAX_RESULT_BYTES = 16_000;
const OPENROUTER_FREE_MODELS = (process.env.OPENROUTER_FREE_MODELS ||
  'meta-llama/llama-3.1-8b-instruct:free,mistralai/mistral-7b-instruct:free,google/gemma-2-9b-it:free')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS || 8_000);
const MODEL_CACHE_TTL_MS = Number(process.env.OPENROUTER_MODEL_CACHE_MS || 10 * 60 * 1000);

let cachedOpenRouterModels = {
  fetchedAt: 0,
  models: [],
};

const SUPPORTED_LANGUAGES = {
  c: {
    extension: 'c',
    command: ['sh', '-lc', 'gcc -O2 -std=c11 /workspace/Main.c -o /tmp/main && /tmp/main'],
  },
  cpp: {
    extension: 'cpp',
    command: ['sh', '-lc', 'g++ -O2 -std=c++17 /workspace/Main.cpp -o /tmp/main && /tmp/main'],
  },
  js: {
    extension: 'js',
    command: ['node', 'Main.js'],
  },
  py: {
    extension: 'py',
    command: ['python3', 'Main.py'],
  },
  go: {
    extension: 'go',
    command: ['sh', '-lc', 'cp /workspace/Main.go /tmp/Main.go && cd /tmp && GOCACHE=/tmp/go-cache go run Main.go'],
  },
  rs: {
    extension: 'rs',
    command: ['sh', '-lc', 'rustc /workspace/Main.rs -O -o /tmp/main && /tmp/main'],
  },
  java: {
    extension: 'java',
    command: ['sh', '-lc', 'cp /workspace/Main.java /tmp/Main.java && cd /tmp && javac Main.java && java Main'],
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_FILENAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FULL_FILENAME_RE = /^[A-Za-z0-9_-]{1,64}\.(c|cpp|js|py|go|rs|java)$/;

const parseAllowedOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS policy'));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

const baseRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const compileRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const aiRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(baseRateLimiter);

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const requestLatency = new client.Histogram({
  name: 'http_request_latency_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 4, 8],
});

const requestCount = new client.Counter({
  name: 'http_request_count',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.path;
    const statusCode = String(res.statusCode);
    const durationNs = process.hrtime.bigint() - start;
    const durationSeconds = Number(durationNs) / 1e9;

    requestLatency.labels(req.method, route, statusCode).observe(durationSeconds);
    requestCount.labels(req.method, route, statusCode).inc();
  });
  next();
});

AWS.config.update({
  region: process.env.Region,
  accessKeyId: process.env.accessKeyId,
  secretAccessKey: process.env.secretAccessKey,
});

const s3 = new AWS.S3();

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const parseEmail = (value) => {
  if (!isNonEmptyString(value)) {
    throw new Error('Email is required');
  }
  const trimmed = value.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error('Invalid email format');
  }
  return trimmed;
};

const parseLanguage = (value) => {
  if (!isNonEmptyString(value)) {
    throw new Error('Language is required');
  }
  const trimmed = value.trim();
  if (!SUPPORTED_LANGUAGES[trimmed]) {
    throw new Error('Unsupported language');
  }
  return trimmed;
};

const parseCode = (value) => {
  if (typeof value !== 'string') {
    throw new Error('Code must be a string');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_CODE_BYTES) {
    throw new Error('Code exceeds size limit');
  }
  return value;
};

const parseInput = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('Input must be a string');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_STDIN_BYTES) {
    throw new Error('Input exceeds size limit');
  }
  return value;
};

const parseBaseFileName = (value) => {
  if (!isNonEmptyString(value)) {
    throw new Error('File name is required');
  }
  const trimmed = value.trim();
  if (!BASE_FILENAME_RE.test(trimmed)) {
    throw new Error('Invalid file name');
  }
  return trimmed;
};

const parseFullFileName = (value) => {
  if (!isNonEmptyString(value)) {
    throw new Error('File name is required');
  }
  const trimmed = value.trim();
  if (!FULL_FILENAME_RE.test(trimmed)) {
    throw new Error('Invalid file name');
  }
  return trimmed;
};

const parsePrompt = (value) => {
  if (!isNonEmptyString(value)) {
    throw new Error('Prompt is required');
  }
  const trimmed = value.trim();
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_PROMPT_BYTES) {
    throw new Error('Prompt exceeds size limit');
  }
  return trimmed;
};

const parseAiModel = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Model must be a string');
  }

  const trimmed = value.trim();
  if (trimmed.length > 120) {
    throw new Error('Model is too long');
  }
  if (!/^[a-zA-Z0-9._:/-]+$/.test(trimmed)) {
    throw new Error('Invalid model format');
  }
  if (!trimmed.endsWith(':free')) {
    throw new Error('Unsupported model');
  }

  return trimmed;
};

const ensureOutputLimit = (chunks) => {
  const joined = chunks.join('');
  if (Buffer.byteLength(joined, 'utf8') > MAX_RESULT_BYTES) {
    return `${joined.slice(0, MAX_RESULT_BYTES)}\n\n[output truncated]`;
  }
  return joined;
};

const parseJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getOpenRouterFreeModels = async () => {
  const now = Date.now();
  if (now - cachedOpenRouterModels.fetchedAt < MODEL_CACHE_TTL_MS && cachedOpenRouterModels.models.length > 0) {
    return cachedOpenRouterModels.models;
  }

  try {
    const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
    const response = await fetch(OPENROUTER_MODELS_URL, { headers });
    if (!response.ok) {
      return OPENROUTER_FREE_MODELS;
    }

    const payload = await parseJsonSafely(response);
    const models = Array.isArray(payload?.data)
      ? payload.data
          .map((item) => item?.id)
          .filter((id) => typeof id === 'string' && id.endsWith(':free'))
      : [];

    const finalModels = models.length > 0 ? [...new Set(models)] : OPENROUTER_FREE_MODELS;
    cachedOpenRouterModels = {
      fetchedAt: now,
      models: finalModels,
    };

    return finalModels;
  } catch {
    return OPENROUTER_FREE_MODELS;
  }
};

const runDockerCode = async ({ lang, code, input }) => {
  const languageConfig = SUPPORTED_LANGUAGES[lang];
  const extension = languageConfig.extension;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeplayground-'));
  const sourcePath = path.join(tmpDir, `Main.${extension}`);

  try {
    await fs.writeFile(sourcePath, code, 'utf8');

    const containerName = `cp-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--name',
      containerName,
      '--memory',
      '128m',
      '--memory-swap',
      '128m',
      '--cpus',
      '1',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,exec,nosuid,size=64m',
      '--security-opt',
      'no-new-privileges',
      '--cap-drop',
      'ALL',
      '--pids-limit',
      '64',
      '--ulimit',
      'nproc=64:64',
      '-v',
      `${tmpDir}:/workspace:ro`,
      '--workdir',
      '/workspace',
      '--user',
      'nobody',
      'comp',
      ...languageConfig.command,
    ];

    return await new Promise((resolve, reject) => {
      const child = spawn('docker', dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks = [];
      const stderrChunks = [];
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, EXECUTION_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk.toString());
      });

      child.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk.toString());
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start Docker: ${error.message}`));
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);

        const stdout = ensureOutputLimit(stdoutChunks);
        const stderr = ensureOutputLimit(stderrChunks);

        if (timedOut) {
          const timeoutError = new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`);
          timeoutError.type = 'timeout';
          reject(timeoutError);
          return;
        }

        if (exitCode !== 0) {
          const executionError = new Error(stderr || 'Code execution failed');
          executionError.type = 'execution';
          reject(executionError);
          return;
        }

        resolve(stdout);
      });

      child.stdin.write(input || '');
      child.stdin.end();
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const uploadCodeToS3 = async ({ email, fileNameWithExt, code }) => {
  await s3
    .putObject({
      Bucket: BUCKET_NAME,
      Key: `${email}/${fileNameWithExt}`,
      Body: code,
      ContentType: 'text/plain; charset=utf-8',
    })
    .promise();
};

const callOpenRouter = async ({ prompt, code, model }) => {
  if (!API_KEY) {
    throw new Error('AI service is not configured');
  }

  const availableModels = await getOpenRouterFreeModels();
  const candidateModels = model
    ? [model, ...availableModels.filter((candidate) => candidate !== model)]
    : availableModels;
  const failures = [];

  for (const candidateModel of candidateModels) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': OPENROUTER_SITE_URL,
          'X-Title': OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model: candidateModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a concise coding assistant. Provide practical, correct suggestions and include examples when useful.',
            },
            {
              role: 'user',
              content: `${prompt}\n\nCode:\n${code}`,
            },
          ],
          max_tokens: 800,
          temperature: 0.3,
        }),
      });

      const payload = await parseJsonSafely(response);

      if (!response.ok) {
        const errMessage =
          payload?.error?.message || payload?.message || `OpenRouter request failed (${response.status})`;
        failures.push(`${candidateModel}: ${errMessage}`);
        continue;
      }

      const answer = payload?.choices?.[0]?.message?.content;
      if (!answer || typeof answer !== 'string') {
        failures.push(`${candidateModel}: OpenRouter returned an empty response`);
        continue;
      }

      return { answer, model: candidateModel };
    } catch (error) {
      failures.push(`${candidateModel}: ${error.message}`);
    }
  }

  const detail = failures.length > 0 ? failures.slice(0, 2).join(' | ') : 'No available free model responded';
  const upstreamError = new Error(`AI provider unavailable: ${detail}`);
  upstreamError.type = 'upstream';
  throw upstreamError;
};

app.post('/compile', compileRateLimiter, async (req, res) => {
  try {
    const email = parseEmail(req.body.email);
    const lang = parseLanguage(req.body.lang);
    const code = parseCode(req.body.code);
    const input = parseInput(req.body.input);
    const baseFileName = parseBaseFileName(req.body.fname);
    const fileNameWithExt = `${baseFileName}.${lang}`;

    const startedAt = Date.now();
    const out = await runDockerCode({ lang, code, input });
    await uploadCodeToS3({ email, fileNameWithExt, code });
    const executionMs = Date.now() - startedAt;

    res.status(200).json({
      out,
      meta: {
        lang,
        file: fileNameWithExt,
        executionMs,
      },
    });
  } catch (error) {
    const isValidationError = /required|invalid|unsupported|must be|exceeds/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : error.type === 'execution' || error.type === 'timeout' ? 422 : 500;
    if (status === 422) {
      res.status(status).json({ error: error.message });
      return;
    }
    res.status(status).json({ error: status === 400 ? error.message : 'Error during code execution' });
  }
});

app.post('/saveCode', async (req, res) => {
  try {
    const email = parseEmail(req.body.email);
    const lang = parseLanguage(req.body.lang);
    const code = parseCode(req.body.code);
    const baseFileName = parseBaseFileName(req.body.fname);
    const fileNameWithExt = `${baseFileName}.${lang}`;

    await uploadCodeToS3({ email, fileNameWithExt, code });
    res.status(200).json({ success: true, file: fileNameWithExt });
  } catch (error) {
    const isValidationError = /required|invalid|unsupported|must be|exceeds/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to save file' });
  }
});

app.get('/getCode', async (req, res) => {
  try {
    const email = parseEmail(req.query.email);

    const result = await s3
      .listObjectsV2({
        Bucket: BUCKET_NAME,
        Prefix: `${email}/`,
      })
      .promise();

    const files = (result.Contents || [])
      .map((item) => item.Key)
      .filter((key) => typeof key === 'string' && key.startsWith(`${email}/`))
      .map((key) => key.split('/')[1])
      .filter((name) => FULL_FILENAME_RE.test(name))
      .sort((a, b) => a.localeCompare(b));

    res.status(200).json({ files });
  } catch (error) {
    const isValidationError = /required|invalid/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to fetch files' });
  }
});

app.get('/getCodeValue', async (req, res) => {
  try {
    const email = parseEmail(req.query.email);
    const fileName = parseFullFileName(req.query.fname);

    const object = await s3
      .getObject({
        Bucket: BUCKET_NAME,
        Key: `${email}/${fileName}`,
      })
      .promise();

    res.status(200).json({ success: true, content: object.Body.toString('utf8') });
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const isValidationError = /required|invalid/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to fetch file' });
  }
});

app.post('/codeAi', aiRateLimiter, async (req, res) => {
  try {
    const prompt = parsePrompt(req.body.prompt);
    const model = parseAiModel(req.body.model);
    const code = typeof req.body.code === 'string' ? req.body.code.slice(0, MAX_CODE_BYTES) : '';
    const response = await callOpenRouter({ prompt, code, model });

    res.status(200).json(response);
  } catch (error) {
    const isValidationError = /required|invalid|unsupported|exceeds|must be/.test(error.message.toLowerCase());
    const isConfigError = /not configured/i.test(error.message);
    const status = isValidationError ? 400 : isConfigError ? 503 : error.type === 'upstream' ? 502 : 500;
    const message = status === 400 || status === 502 || status === 503 ? error.message : 'AI request failed';
    res.status(status).json({ error: message });
  }
});

app.delete('/deleteCode', async (req, res) => {
  try {
    const email = parseEmail(req.query.email);
    const fileName = parseFullFileName(req.query.fname);

    await s3
      .deleteObject({
        Bucket: BUCKET_NAME,
        Key: `${email}/${fileName}`,
      })
      .promise();

    res.status(200).json({ success: true });
  } catch (error) {
    const isValidationError = /required|invalid/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to delete file' });
  }
});

app.post('/renameCode', async (req, res) => {
  try {
    const email = parseEmail(req.body.email);
    const fromName = parseFullFileName(req.body.from);
    const toName = parseFullFileName(req.body.to);

    if (fromName === toName) {
      throw new Error('Source and destination file names must be different');
    }

    await s3
      .copyObject({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${email}/${fromName}`,
        Key: `${email}/${toName}`,
      })
      .promise();

    await s3
      .deleteObject({
        Bucket: BUCKET_NAME,
        Key: `${email}/${fromName}`,
      })
      .promise();

    res.status(200).json({ success: true, file: toName });
  } catch (error) {
    const isValidationError = /required|invalid|must be|different/.test(error.message.toLowerCase());
    const status = isValidationError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? error.message : 'Failed to rename file' });
  }
});

app.get('/runtime', async (req, res) => {
  const aiModels = await getOpenRouterFreeModels();
  res.status(200).json({
    languages: Object.keys(SUPPORTED_LANGUAGES),
    aiModels,
    limits: {
      maxCodeBytes: MAX_CODE_BYTES,
      maxInputBytes: MAX_STDIN_BYTES,
      maxPromptBytes: MAX_PROMPT_BYTES,
      maxOutputBytes: MAX_RESULT_BYTES,
      executionTimeoutMs: EXECUTION_TIMEOUT_MS,
    },
    bucket: BUCKET_NAME,
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'codeplayground-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (token && req.query.token !== token) {
    res.status(401).send('Unauthorized');
    return;
  }

  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

app.use((error, req, res, next) => {
  if (error?.message?.includes('CORS')) {
    res.status(403).json({ error: 'Request blocked by CORS policy' });
    return;
  }
  next(error);
});

app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
