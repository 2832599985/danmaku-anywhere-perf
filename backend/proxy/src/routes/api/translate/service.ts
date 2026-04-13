import {
  type GenerationConfig,
  GoogleGenerativeAI,
  SchemaType,
} from '@google/generative-ai'

const SYSTEM_PROMPT = `You are a translation assistant for danmaku (bullet comments) on video streaming platforms.
Translate the given texts to the specified target language.
Rules:
- Preserve the original tone and style (casual, humorous, slang, etc.)
- Keep emoticons, emojis, and special symbols as-is
- If a text is already in the target language, return it unchanged
- Keep translations concise since these are short on-screen comments
- Return ONLY the JSON array of translated strings, in the same order as the input`

const generationConfig: GenerationConfig = {
  temperature: 0.3,
  responseMimeType: 'application/json',
  responseSchema: {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.STRING,
    },
  },
}

interface TranslateBatchParams {
  env: Env
  texts: string[]
  targetLang: string
}

export async function translateWithGemini({
  env,
  texts,
  targetLang,
}: TranslateBatchParams): Promise<string[]> {
  const GEMINI_API_KEY = await env.DANMAKU_GEMINI_API_KEY.get()
  const DA_AI_GATEWAY_NAME = await env.DA_AI_GATEWAY_NAME.get()
  const DA_AI_GATEWAY_ID = await env.DA_AI_GATEWAY_ID.get()
  const modelName = env.GEMINI_MODEL

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

  const model = genAI.getGenerativeModel(
    {
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    },
    {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${DA_AI_GATEWAY_ID}/${DA_AI_GATEWAY_NAME}/google-ai-studio`,
    }
  )

  const session = model.startChat({
    generationConfig,
    history: [],
  })

  const langMap: Record<string, string> = {
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese (Simplified)',
    ko: 'Korean',
  }

  const prompt = `Translate the following ${texts.length} danmaku comments to ${langMap[targetLang] ?? targetLang}:\n${JSON.stringify(texts)}`

  const result = await session.sendMessage(prompt)
  const parsed: string[] = JSON.parse(result.response.text())

  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error(
      `Translation response length mismatch: expected ${texts.length}, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`
    )
  }

  return parsed
}
