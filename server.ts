/**
 * CodeDoc Context Isolator — API server.
 *
 * Serves the React client (via Vite middleware in development, static files in
 * production) and proxies every Gemini API call so the API key never reaches the
 * browser.
 *
 * WHAT CHANGED AND WHY
 * 1. Every route now validates its request body with zod. Previously each
 *    handler destructured `req.body` unchecked and forwarded `model` straight to
 *    the Gemini SDK, so any client could name any model — including ones more
 *    expensive than the UI offers — and a malformed body produced a confusing
 *    500 from deep inside the SDK instead of a 400.
 * 2. The API key is verified at BOOT. It used to be checked inside
 *    `getAIClient()` on every request, which meant a misconfigured deployment
 *    started up "healthy" and then failed one call at a time — and the client
 *    silently substituted fabricated scores for those failures.
 * 3. The GoogleGenAI client is created once, not per request.
 * 4. Embeddings are batched into a single call instead of a sequential loop.
 * 5. The dead `/api/gemini/evaluate-arms` endpoint is removed. Nothing called
 *    it, and it was the NON-blind judge variant: it revealed each arm's identity
 *    and the hidden ground-truth intent to the grader, which would bias scores.
 *    All judging goes through the blind endpoint.
 * 6. `PORT` comes from the environment (Cloud Run injects it), responses are
 *    compressed, and an unmatched `/api/*` returns JSON rather than the SPA's
 *    HTML — which used to surface as a JSON parse error in the client.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  ALLOWED_MODEL_IDS,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_MODEL,
  EMBEDDING_MODEL,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
} from './src/config/models';

dotenv.config();

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reads and validates server configuration, exiting immediately if anything
 * required is missing.
 *
 * Failing at boot is a deliberate choice: a server that starts without an API
 * key looks healthy to a load balancer but cannot do its only job. Crashing
 * here produces one obvious error in the logs instead of an intermittent,
 * per-request failure that the client would mask.
 */
function loadServerConfig() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim().length === 0 || apiKey === 'MY_GEMINI_API_KEY') {
    console.error(
      [
        '',
        'FATAL: GEMINI_API_KEY is not set.',
        '',
        'This server cannot serve any benchmark request without it.',
        'Set it in a .env file at the project root (see .env.example):',
        '',
        '  GEMINI_API_KEY="your-key-here"',
        '',
        'Get a key at https://aistudio.google.com/apikey',
        '',
      ].join('\n')
    );
    process.exit(1);
  }

  return {
    apiKey,
    // Cloud Run and most PaaS providers inject PORT; 3000 is the local default.
    port: Number(process.env.PORT) || 3000,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

const config = loadServerConfig();

const app = express();

// Gzip/deflate responses. The JSON payloads here (full prompt text, raw model
// responses, claim lists) compress extremely well.
app.use(compression());

// Prompt payloads for four arms at a 2000-token budget are large but nowhere
// near 10mb; the generous limit is retained from the original.
app.use(express.json({ limit: '10mb' }));

/**
 * The Gemini client, created once at module load.
 *
 * The previous implementation constructed a new `GoogleGenAI` on every single
 * request — for a 10-trial run that is ~90 client constructions, each rebuilding
 * auth and HTTP plumbing for no reason.
 */
const aiClient = new GoogleGenAI({
  apiKey: config.apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/* -------------------------------------------------------------------------- */
/* Request validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A model id constrained to the application's allowlist.
 *
 * `ALLOWED_MODEL_IDS` is derived from the same registry the UI dropdown reads,
 * so the client and server can never disagree about what is callable.
 */
const modelIdSchema = z
  .enum(ALLOWED_MODEL_IDS as [string, ...string[]])
  .default(DEFAULT_MODEL);

const judgeModelIdSchema = z
  .enum(ALLOWED_MODEL_IDS as [string, ...string[]])
  .default(DEFAULT_JUDGE_MODEL);

/** One arm's fully-built prompt, as produced by `buildConditionPrompts`. */
const promptPayloadSchema = z.object({
  title: z.string(),
  role: z.string(),
  systemInstruction: z.string(),
  userPrompt: z.string().min(1, 'userPrompt cannot be empty'),
});

const generateArmsSchema = z.object({
  promptPayloads: z.record(z.string(), promptPayloadSchema),
  model: modelIdSchema,
  // Gemini accepts 0..2. The old handler clamped to 1.0 silently, making half
  // the range unreachable with no explanation to the user.
  temperature: z.number().min(MIN_TEMPERATURE).max(MAX_TEMPERATURE).default(0.2),
});

const countTokensSchema = z.object({
  text: z.string(),
  model: modelIdSchema,
});

const embedTextsSchema = z.object({
  texts: z.array(z.string()).min(1).max(64),
  model: z.string().default(EMBEDDING_MODEL),
});

const evaluateFactualitySchema = z.object({
  armKey: z.string().optional(),
  docstring: z.string().min(1, 'docstring cannot be empty'),
  targetCode: z.string().default(''),
  armContextText: z.string().default(''),
  model: judgeModelIdSchema,
});

const evaluateBlindArmsSchema = z.object({
  target: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    language: z.string().default('text'),
    targetCode: z.string().min(1),
    referenceDocstring: z.string().default(''),
  }),
  blindCandidates: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        docstring: z.string(),
      })
    )
    .min(1)
    .max(6),
  model: judgeModelIdSchema,
});

/**
 * Validates a request body and writes a 400 response if it fails.
 *
 * Returns the parsed, defaulted data on success or `null` on failure, so each
 * handler reduces to `const body = parseBody(...); if (!body) return;`.
 *
 * Errors are reported as `field: message` strings, which is far more actionable
 * during development than the SDK's downstream complaint about a missing field.
 */
function parseBody<TSchema extends z.ZodType>(
  schema: TSchema,
  req: Request,
  res: Response
): z.infer<TSchema> | null {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
    );
    res.status(400).json({ error: 'Invalid request body', details });
    return null;
  }

  return result.data;
}

/**
 * Normalizes an unknown thrown value into a message safe to send to the client.
 *
 * Gemini SDK errors carry useful text (quota exhausted, model not found, safety
 * block) that the UI now surfaces directly — previously these were swallowed
 * into a console warning while the client invented a score in their place.
 */
function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Shared response schemas                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The per-candidate scoring schema enforced on the judge's JSON output.
 *
 * This was previously copy-pasted four times (once per arm, ~25 lines each) in
 * the removed non-blind endpoint. Building it from a function means the rubric
 * shape is defined exactly once.
 */
function buildCandidateEvaluationSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      accuracyScore: { type: Type.NUMBER },
      paramReturnScore: { type: Type.NUMBER },
      intentScore: { type: Type.NUMBER },
      hallucinationScore: { type: Type.NUMBER },
      overallQuality: { type: Type.NUMBER },
      judgeCritique: { type: Type.STRING },
      keyInsightsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
      hallucinationsIdentified: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: [
      'accuracyScore',
      'paramReturnScore',
      'intentScore',
      'hallucinationScore',
      'overallQuality',
      'judgeCritique',
    ],
  };
}

/**
 * Strips a markdown code fence from a model response.
 *
 * Models frequently wrap a requested docstring in ```python ... ``` despite
 * being told to emit only the docstring; leaving the fence in would corrupt
 * every downstream lexical metric (BLEU, ROUGE-L) with tokens the reference
 * docstring cannot contain.
 */
function cleanDocstring(raw: string): string {
  if (!raw) return '';
  const text = raw.trim();
  const codeBlockMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  return codeBlockMatch ? codeBlockMatch[1].trim() : text;
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

/** Liveness probe. Also reports which models this deployment will accept. */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    allowedModels: ALLOWED_MODEL_IDS,
  });
});

/**
 * Generates one docstring per experimental arm, all arms in parallel.
 *
 * Arms are independent by design — that is the point of the experiment — so
 * they are issued concurrently. A failure in one arm is reported as a failed
 * arm rather than failing the whole request, because a partial trial is still
 * analysable as long as the UI knows which arms are missing.
 */
app.post('/api/gemini/generate-arms', async (req, res) => {
  const body = parseBody(generateArmsSchema, req, res);
  if (!body) return;

  try {
    const conditions = Object.keys(body.promptPayloads);

    const resultsArray = await Promise.all(
      conditions.map(async (condKey) => {
        const payload = body.promptPayloads[condKey];
        const startTime = Date.now();

        try {
          const response = await aiClient.models.generateContent({
            model: body.model,
            contents: payload.userPrompt,
            config: {
              systemInstruction: payload.systemInstruction,
              temperature: body.temperature,
            },
          });

          const rawText = response.text || '';

          // Report the tokenizer's OWN counts back to the client.
          //
          // WHY: the client has a ~3.8 chars/token heuristic for live slider
          // feedback, but it was labelling heuristic estimates as "ACTUAL"
          // token counts in results and exports. `usageMetadata` is the real
          // measurement, it costs nothing extra (it rides along on the
          // generation response), and it is the only way to verify that the
          // fixed-budget experimental control actually held.
          const usage = response.usageMetadata;

          return {
            condition: condKey,
            title: payload.title,
            role: payload.role,
            generatedDocstring: cleanDocstring(rawText),
            rawResponse: rawText,
            latencyMs: Date.now() - startTime,
            status: 'completed' as const,
            usage: usage
              ? {
                  promptTokens: usage.promptTokenCount ?? null,
                  outputTokens: usage.candidatesTokenCount ?? null,
                  totalTokens: usage.totalTokenCount ?? null,
                }
              : null,
          };
        } catch (err: unknown) {
          const errorMessage = toErrorMessage(err, 'Generation failed');
          console.error(`Generation error for arm ${condKey}:`, errorMessage);

          // NOTE: no placeholder docstring is returned. The client marks this
          // arm failed and excludes it from statistics. Returning a synthetic
          // string here is what previously let a broken run look successful.
          return {
            condition: condKey,
            title: payload.title,
            role: payload.role,
            generatedDocstring: '',
            rawResponse: '',
            latencyMs: Date.now() - startTime,
            status: 'error' as const,
            errorMessage,
            usage: null,
          };
        }
      })
    );

    const resultsMap: Record<string, (typeof resultsArray)[number]> = {};
    for (const result of resultsArray) {
      resultsMap[result.condition] = result;
    }

    res.json({ results: resultsMap });
  } catch (error: unknown) {
    const message = toErrorMessage(error, 'Failed to generate arms');
    console.error('Error in /api/gemini/generate-arms:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Counts tokens using the official Gemini tokenizer.
 *
 * The app's local heuristic (~3.8 chars/token) is good enough for live slider
 * feedback but is NOT the real count, so results computed from it must not be
 * labelled "actual". This endpoint provides the authoritative number for
 * committed payloads.
 */
app.post('/api/gemini/count-tokens', async (req, res) => {
  const body = parseBody(countTokensSchema, req, res);
  if (!body) return;

  // An empty string costs nothing and needs no round trip.
  if (body.text.length === 0) {
    res.json({ totalTokens: 0 });
    return;
  }

  try {
    const countRes = await aiClient.models.countTokens({
      model: body.model,
      contents: body.text,
    });
    res.json({ totalTokens: countRes.totalTokens || 0 });
  } catch (error: unknown) {
    const message = toErrorMessage(error, 'Failed to count tokens');
    console.warn('Error counting tokens with Gemini API:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Embeds several texts in ONE request for the semantic-similarity metric.
 *
 * The previous implementation awaited `embedContent` inside a `for` loop — five
 * sequential round trips per trial, each paying full network latency, for data
 * that has no ordering dependency whatsoever. The SDK accepts an array of
 * contents, so this is now a single call; `Promise.all` is the fallback if the
 * batch form is rejected by the installed SDK version.
 */
app.post('/api/gemini/embed-texts', async (req, res) => {
  const body = parseBody(embedTextsSchema, req, res);
  if (!body) return;

  // The API rejects empty content, so blanks become a single space and are
  // filtered out by cosine similarity downstream (a zero vector scores 0).
  const texts = body.texts.map((t) => (t && t.trim().length > 0 ? t : ' '));

  try {
    const batchResponse = await aiClient.models.embedContent({
      model: body.model,
      contents: texts,
    });

    const embeddings = (batchResponse.embeddings ?? []).map((e) => e.values ?? []);

    if (embeddings.length === texts.length) {
      res.json({ embeddings });
      return;
    }

    // Batch returned an unexpected shape — fall back to concurrent singles.
    throw new Error(
      `Batch embedding returned ${embeddings.length} vectors for ${texts.length} inputs`
    );
  } catch (batchError: unknown) {
    console.warn(
      'Batch embedding unavailable, falling back to concurrent single calls:',
      toErrorMessage(batchError, 'unknown error')
    );

    try {
      const embeddings = await Promise.all(
        texts.map(async (text) => {
          try {
            const single = await aiClient.models.embedContent({
              model: body.model,
              contents: text,
            });
            return single.embeddings?.[0]?.values ?? [];
          } catch {
            // An empty vector yields a similarity of 0, which the UI shows as
            // a missing metric rather than a fabricated score.
            return [];
          }
        })
      );
      res.json({ embeddings });
    } catch (error: unknown) {
      const message = toErrorMessage(error, 'Failed to embed texts');
      console.warn('Error computing embeddings:', message);
      res.status(500).json({ error: message });
    }
  }
});

/**
 * Checks a docstring's factual claims against ONLY the evidence its arm saw.
 *
 * This is the experiment's key fairness control: a docstring that correctly
 * describes a caller relationship is only "supported" for the arm that was
 * actually shown the call graph. For the code-only arm the same sentence is an
 * unsupported guess, even though it happens to be true.
 */
app.post('/api/gemini/evaluate-factuality', async (req, res) => {
  const body = parseBody(evaluateFactualitySchema, req, res);
  if (!body) return;

  try {
    const prompt = `You are a strict technical factuality judge.
Analyze the following candidate docstring against ONLY the provided code and context evidence.
Do NOT reward claims that are asserted without evidence in this specific context.

Candidate Docstring:
\`\`\`
${body.docstring}
\`\`\`

Target Function Implementation:
\`\`\`
${body.targetCode}
\`\`\`

Evidence Supplied to this Arm:
\`\`\`
${body.armContextText || '(No extra repository context supplied - only target function code)'}
\`\`\`

Extract testable factual claims made in the docstring (e.g. parameter semantics, edge cases handled, caller relationships, concurrency properties).
For each claim, determine:
- classification: "SUPPORTED" if directly evidenced in the supplied code or context.
- "UNSUPPORTED" if the docstring claims specific behavior, external callers, architectural links, or invariants not present in the provided evidence.
- "UNCERTAIN" if it is a plausible generic inference that cannot be definitively proved or disproved.
- evidence: 1 sentence citing why it is supported or unsupported.`;

    const response = await aiClient.models.generateContent({
      model: body.model,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  claim: { type: Type.STRING },
                  classification: {
                    type: Type.STRING,
                    enum: ['SUPPORTED', 'UNSUPPORTED', 'UNCERTAIN'],
                  },
                  evidence: { type: Type.STRING },
                },
                required: ['id', 'claim', 'classification', 'evidence'],
              },
            },
          },
          required: ['claims'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    const claims = Array.isArray(parsed.claims) ? parsed.claims : [];

    let supported = 0;
    let unsupported = 0;
    let uncertain = 0;
    for (const claim of claims) {
      if (claim.classification === 'SUPPORTED') supported++;
      else if (claim.classification === 'UNSUPPORTED') unsupported++;
      else uncertain++;
    }

    const total = claims.length;

    res.json({
      factuality: {
        totalClaims: total,
        supportedClaims: supported,
        unsupportedClaims: unsupported,
        uncertainClaims: uncertain,
        // With no extractable claims there is nothing to contradict, so the
        // rate is reported as 100% supported of zero claims; the UI shows the
        // claim count alongside it so this cannot be mistaken for a strong
        // result.
        factualityScore: total > 0 ? Number(((supported / total) * 100).toFixed(1)) : 100,
        unsupportedClaimRate: total > 0 ? Number(((unsupported / total) * 100).toFixed(1)) : 0,
        claims,
      },
    });
  } catch (error: unknown) {
    const message = toErrorMessage(error, 'Failed factuality evaluation');
    console.error('Factuality evaluation error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Double-blind evaluation of anonymized candidates.
 *
 * The judge sees "Candidate A".."Candidate D" in randomized order and is given
 * the target code plus the gold reference docstring for calibration — but NOT
 * which arm produced which candidate, and NOT the hidden ground-truth intent.
 * Withholding the latter is essential: telling the grader the secret that only
 * the treatment arms could know would hand those arms the answer key.
 */
app.post('/api/gemini/evaluate-blind-arms', async (req, res) => {
  const body = parseBody(evaluateBlindArmsSchema, req, res);
  if (!body) return;

  try {
    const { target, blindCandidates } = body;

    const candidatesPrompt = blindCandidates
      .map(
        (candidate) =>
          `### [${candidate.candidateId}]:\n\`\`\`\n${
            candidate.docstring || '(No docstring generated)'
          }\n\`\`\`\n`
      )
      .join('\n');

    const evaluationPrompt = `You are a strict, world-class Principal Software Architect and Benchmarking Judge.
We are conducting an empirical double-blind scientific evaluation of code documentation quality.
You do NOT know the origin or condition of any candidate. Each candidate is anonymized.

You are given:
1. The Target Function Code:
\`\`\`${target.language}
${target.targetCode}
\`\`\`

2. Gold Reference Docstring (for calibration of accuracy & tone):
\`\`\`
${target.referenceDocstring}
\`\`\`

---

Now, independently and rigorously evaluate each candidate below on their own merits:

${candidatesPrompt}

SCORING CRITERIA (1 to 10 scale):
1. accuracyScore (1-10): How functionally accurate is the docstring in describing what the function computes?
2. paramReturnScore (1-10): How thorough and exact are parameter types, default values, return specs, and invariants?
3. intentScore (1-10): Does it capture the architectural 'WHY', edge cases, error conditions, and invariants?
4. hallucinationScore (1-10): 10 = Zero false claims or fictitious parameters; 1 = severe hallucinations.
5. overallQuality (0-100): Composite weighted score: (0.35 * accuracy + 0.25 * paramReturn + 0.25 * intent + 0.15 * hallucination) * 10.
6. judgeCritique: 2-3 sentences of sharp technical commentary on this candidate's strengths and weaknesses.
7. keyInsightsFound: Array of critical insights or edge cases correctly identified.
8. hallucinationsIdentified: Array of fictitious or misleading claims (empty array if none).

Return a JSON object mapping each candidate ID (e.g. "Candidate A", "Candidate B", etc.) to its evaluation.`;

    const candidateKeys = blindCandidates.map((candidate) => candidate.candidateId);
    const propertiesObj: Record<string, ReturnType<typeof buildCandidateEvaluationSchema>> = {};
    for (const key of candidateKeys) {
      propertiesObj[key] = buildCandidateEvaluationSchema();
    }

    const response = await aiClient.models.generateContent({
      model: body.model,
      contents: evaluationPrompt,
      config: {
        // Judging is held at a low temperature so that re-running a trial
        // measures generator variance, not grader variance.
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: propertiesObj,
          required: candidateKeys,
        },
      },
    });

    const parsedEvaluations = JSON.parse(response.text?.trim() || '{}');
    res.json({ evaluations: parsedEvaluations });
  } catch (error: unknown) {
    const message = toErrorMessage(error, 'Failed blind evaluation');
    console.error('Blind evaluation error in /api/gemini/evaluate-blind-arms:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * JSON 404 for unmatched API paths.
 *
 * Without this, a typo'd endpoint fell through to the SPA fallback and returned
 * `index.html` with a 200 status — which the client then tried to parse as JSON,
 * producing an error message that pointed nowhere near the real mistake.
 */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint' });
});

/**
 * Terminal error handler.
 *
 * Catches anything thrown synchronously in middleware — most usefully the body
 * parser's own error on malformed JSON, which otherwise produced an HTML error
 * page in an XHR response.
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled server error:', error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: toErrorMessage(error, 'Internal server error') });
});

/* -------------------------------------------------------------------------- */
/* Static hosting / dev middleware                                            */
/* -------------------------------------------------------------------------- */

/**
 * Starts the HTTP server.
 *
 * In development, Vite runs in middleware mode inside this same process so that
 * the client and the API share one origin (no CORS, no proxy config). In
 * production the pre-built assets are served from `dist`.
 */
async function startServer() {
  if (!config.isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    // Vite emits content-hashed filenames, so built assets are safe to cache
    // aggressively; index.html is revalidated so a deploy is picked up at once.
    app.use(
      express.static(distPath, {
        maxAge: '1y',
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // SPA fallback. NOTE: the '*' pattern requires Express 4 — Express 5's
    // path-to-regexp v8 would need '/*splat' here.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.info(
      `CodeDoc Isolator server listening on http://0.0.0.0:${config.port} ` +
        `(${config.isProduction ? 'production' : 'development'})`
    );
  });
}

startServer();
