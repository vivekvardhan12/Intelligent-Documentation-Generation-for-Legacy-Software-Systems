import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Initialize GoogleGenAI client
function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing in server environment");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Helper to extract docstring from model response
function cleanDocstring(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();
  // Strip outer markdown code blocks if the model wrapped the docstring in ```python ... ```
  const codeBlockMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  return text;
}

// 1. Generate Docstrings across all 4 Context Arms
app.post("/api/gemini/generate-arms", async (req, res) => {
  try {
    const { promptPayloads, model = "gemini-3.7-flash", temperature = 0.2 } = req.body;

    if (!promptPayloads || typeof promptPayloads !== "object") {
      return res.status(400).json({ error: "Missing promptPayloads object" });
    }

    const ai = getAIClient();
    const conditions = Object.keys(promptPayloads) as Array<
      "code_only" | "few_shot_control" | "call_graph" | "git_history"
    >;

    const generationPromises = conditions.map(async (condKey) => {
      const payload = promptPayloads[condKey];
      const startTime = Date.now();
      try {
        const response = await ai.models.generateContent({
          model: model || "gemini-3.7-flash",
          contents: payload.userPrompt,
          config: {
            systemInstruction: payload.systemInstruction,
            temperature: Math.max(0, Math.min(1.0, Number(temperature) || 0.2)),
          },
        });

        const rawText = response.text || "";
        const cleaned = cleanDocstring(rawText);
        const latencyMs = Date.now() - startTime;

        return {
          condition: condKey,
          title: payload.title,
          role: payload.role,
          generatedDocstring: cleaned,
          rawResponse: rawText,
          promptPayload: payload,
          latencyMs,
          status: "completed" as const,
        };
      } catch (err: any) {
        console.error(`Generation error for arm ${condKey}:`, err);
        return {
          condition: condKey,
          title: payload.title,
          role: payload.role,
          generatedDocstring: `// Generation failed: ${err?.message || "Unknown error"}`,
          rawResponse: "",
          promptPayload: payload,
          latencyMs: Date.now() - startTime,
          status: "error" as const,
          errorMessage: err?.message || "Generation error",
        };
      }
    });

    const resultsArray = await Promise.all(generationPromises);
    const resultsMap: Record<string, any> = {};
    for (const r of resultsArray) {
      resultsMap[r.condition] = r;
    }

    res.json({ results: resultsMap });
  } catch (error: any) {
    console.error("Error in /api/gemini/generate-arms:", error);
    res.status(500).json({ error: error.message || "Failed to generate arms" });
  }
});

// 2. LLM-as-a-Judge Evaluation across all 4 arms simultaneously
app.post("/api/gemini/evaluate-arms", async (req, res) => {
  try {
    const { target, generatedDocstrings, model = "gemini-3.7-flash" } = req.body;

    if (!target || !generatedDocstrings) {
      return res.status(400).json({ error: "Missing target or generatedDocstrings" });
    }

    const ai = getAIClient();

    const evaluationPrompt = `You are a strict, world-class Principal Software Architect and Benchmarking Judge.
We are conducting an empirical scientific experiment to isolate context length vs context type in LLM-generated code documentation.

You are given:
1. The Target Function Code:
\`\`\`${target.language}
${target.targetCode}
\`\`\`

2. Hidden Architectural Intent & Ground Truth Details (revealed by repo context & commit history):
"${target.groundTruthIntent}"

3. Reference Ground Truth Docstring (for gold-standard calibration):
\`\`\`
${target.referenceDocstring}
\`\`\`

---

Now, independently and rigorously evaluate the 4 generated docstrings below:

[Arm A - Code Only (Floor)]:
\`\`\`
${generatedDocstrings.code_only || "(None)"}
\`\`\`

[Arm B - Few-Shot Control (Same token length as Call-Graph/Git-History, but zero repo info)]:
\`\`\`
${generatedDocstrings.few_shot_control || "(None)"}
\`\`\`

[Arm C - Call-Graph Context (Callers, callees, module architecture)]:
\`\`\`
${generatedDocstrings.call_graph || "(None)"}
\`\`\`

[Arm D - Git-History Context (Commits, diffs, PR reasoning)]:
\`\`\`
${generatedDocstrings.git_history || "(None)"}
\`\`\`

---

SCORING CRITERIA (1 to 10 scale):
1. accuracyScore (1-10): How functionally accurate is the docstring describing what the function computes?
2. paramReturnScore (1-10): How thorough and exact are parameter types, default values, return specs, and invariants?
3. intentScore (1-10): Does it capture the hidden architectural 'WHY', edge cases (e.g. clock drift, zero-copy safety, idempotency guarantees, race conditions) that repo context should reveal?
4. hallucinationScore (1-10): 10 = Zero false claims or fictitious parameters; 1 = severe hallucinations.
5. overallQuality (0-100): Composite weighted score (0.35 * accuracy + 0.25 * paramReturn + 0.25 * intent + 0.15 * hallucination) * 10.
6. judgeCritique: 2-3 sentences of sharp technical commentary on this arm's strengths/weaknesses.
7. keyInsightsFound: Array of critical insights or edge cases correctly identified.
8. hallucinationsIdentified: Array of fictitious or misleading claims (empty array if none).

Evaluate all 4 arms in a structured JSON object.`;

    const response = await ai.models.generateContent({
      model: model || "gemini-3.7-flash",
      contents: evaluationPrompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            code_only: {
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
                "accuracyScore",
                "paramReturnScore",
                "intentScore",
                "hallucinationScore",
                "overallQuality",
                "judgeCritique",
              ],
            },
            few_shot_control: {
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
                "accuracyScore",
                "paramReturnScore",
                "intentScore",
                "hallucinationScore",
                "overallQuality",
                "judgeCritique",
              ],
            },
            call_graph: {
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
                "accuracyScore",
                "paramReturnScore",
                "intentScore",
                "hallucinationScore",
                "overallQuality",
                "judgeCritique",
              ],
            },
            git_history: {
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
                "accuracyScore",
                "paramReturnScore",
                "intentScore",
                "hallucinationScore",
                "overallQuality",
                "judgeCritique",
              ],
            },
          },
          required: ["code_only", "few_shot_control", "call_graph", "git_history"],
        },
      },
    });

    const parsedEvaluations = JSON.parse(response.text?.trim() || "{}");
    res.json({ evaluations: parsedEvaluations });
  } catch (error: any) {
    console.error("Error in /api/gemini/evaluate-arms:", error);
    res.status(500).json({ error: error.message || "Failed to evaluate arms" });
  }
});

// 3. Official Gemini Token Counting API
app.post("/api/gemini/count-tokens", async (req, res) => {
  try {
    const { text, model = "gemini-3.7-flash" } = req.body;
    if (typeof text !== "string") {
      return res.status(400).json({ error: "Missing text string" });
    }
    const ai = getAIClient();
    const countRes = await ai.models.countTokens({
      model: model || "gemini-3.7-flash",
      contents: text,
    });
    res.json({ totalTokens: countRes.totalTokens || 0 });
  } catch (error: any) {
    console.warn("Error counting tokens with Gemini API:", error?.message);
    res.status(500).json({ error: error?.message || "Failed to count tokens" });
  }
});

// 4. Gemini Embedding API for Semantic Similarity
app.post("/api/gemini/embed-texts", async (req, res) => {
  try {
    const { texts, model = "text-embedding-004" } = req.body;
    if (!Array.isArray(texts)) {
      return res.status(400).json({ error: "Missing texts array" });
    }
    const ai = getAIClient();
    const embeddings: number[][] = [];
    for (const t of texts) {
      try {
        const embedRes = await ai.models.embedContent({
          model: model || "text-embedding-004",
          contents: t || " ",
        });
        const values = (embedRes as any).embedding?.values || (embedRes as any).embeddings?.[0]?.values || [];
        embeddings.push(values);
      } catch (err) {
        embeddings.push([]);
      }
    }
    res.json({ embeddings });
  } catch (error: any) {
    console.warn("Error computing embeddings:", error?.message);
    res.status(500).json({ error: error?.message || "Failed to embed texts" });
  }
});

// 5. Factuality Evaluation against Arm-Specific Isolated Evidence
app.post("/api/gemini/evaluate-factuality", async (req, res) => {
  try {
    const { armKey, docstring, targetCode, armContextText, model = "gemini-3.7-flash" } = req.body;
    if (!docstring) {
      return res.status(400).json({ error: "Missing docstring" });
    }
    const ai = getAIClient();
    const prompt = `You are a strict technical factuality judge.
Analyze the following candidate docstring against ONLY the provided code and context evidence.
Do NOT reward claims that are asserted without evidence in this specific context.

Candidate Docstring:
\`\`\`
${docstring}
\`\`\`

Target Function Implementation:
\`\`\`
${targetCode}
\`\`\`

Evidence Supplied to this Arm:
\`\`\`
${armContextText || "(No extra repository context supplied - only target function code)"}
\`\`\`

Extract testable factual claims made in the docstring (e.g. parameter semantics, edge cases handled, caller relationships, concurrency properties).
For each claim, determine:
- classification: "SUPPORTED" if directly evidenced in the supplied code or context.
- "UNSUPPORTED" if the docstring claims specific behavior, external callers, architectural links, or invariants not present in the provided evidence.
- "UNCERTAIN" if it is a plausible generic inference that cannot be definitively proved or disproved.
- evidence: 1 sentence citing why it is supported or unsupported.`;

    const response = await ai.models.generateContent({
      model: model || "gemini-3.7-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
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
                  classification: { type: Type.STRING, enum: ["SUPPORTED", "UNSUPPORTED", "UNCERTAIN"] },
                  evidence: { type: Type.STRING },
                },
                required: ["id", "claim", "classification", "evidence"],
              },
            },
          },
          required: ["claims"],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
    let supported = 0;
    let unsupported = 0;
    let uncertain = 0;
    for (const c of claims) {
      if (c.classification === "SUPPORTED") supported++;
      else if (c.classification === "UNSUPPORTED") unsupported++;
      else uncertain++;
    }
    const total = claims.length;
    const factualityScore = total > 0 ? Number(((supported / total) * 100).toFixed(1)) : 100;
    const unsupportedClaimRate = total > 0 ? Number(((unsupported / total) * 100).toFixed(1)) : 0;

    res.json({
      factuality: {
        totalClaims: total,
        supportedClaims: supported,
        unsupportedClaims: unsupported,
        uncertainClaims: uncertain,
        factualityScore,
        unsupportedClaimRate,
        claims,
      },
    });
  } catch (error: any) {
    console.error("Factuality evaluation error:", error?.message);
    res.status(500).json({ error: error?.message || "Failed factuality evaluation" });
  }
});

// 6. Blind Multi-Candidate Evaluation (Anonymized Candidate A, B, C, D)
app.post("/api/gemini/evaluate-blind-arms", async (req, res) => {
  try {
    const { target, blindCandidates, model = "gemini-3.7-flash" } = req.body;
    if (!target || !Array.isArray(blindCandidates)) {
      return res.status(400).json({ error: "Missing target or blindCandidates array" });
    }
    const ai = getAIClient();

    let candidatesPrompt = "";
    for (const c of blindCandidates) {
      candidatesPrompt += `### [${c.candidateId}]:
\`\`\`
${c.docstring || "(No docstring generated)"}
\`\`\`\n\n`;
    }

    const evaluationPrompt = `You are a strict, world-class Principal Software Architect and Benchmarking Judge.
We are conducting an empirical double-blind scientific evaluation of code documentation quality.
You do NOT know the origin or condition of any candidate. Each candidate is anonymized.

You are given:
1. The Target Function Code:
\`\`\`${target.language || "text"}
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

    const candidateKeys = blindCandidates.map((c: any) => c.candidateId);
    const propertiesObj: Record<string, any> = {};
    for (const k of candidateKeys) {
      propertiesObj[k] = {
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
          "accuracyScore",
          "paramReturnScore",
          "intentScore",
          "hallucinationScore",
          "overallQuality",
          "judgeCritique",
        ],
      };
    }

    const response = await ai.models.generateContent({
      model: model || "gemini-3.7-flash",
      contents: evaluationPrompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: propertiesObj,
          required: candidateKeys,
        },
      },
    });

    const parsedEvaluations = JSON.parse(response.text?.trim() || "{}");
    res.json({ evaluations: parsedEvaluations });
  } catch (error: any) {
    console.error("Blind evaluation error in /api/gemini/evaluate-blind-arms:", error);
    res.status(500).json({ error: error?.message || "Failed blind evaluation" });
  }
});

// Vite middleware configuration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CodeDoc Isolator Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
