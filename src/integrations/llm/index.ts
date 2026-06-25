import { logger } from "../../core/logger.js";

export interface ParsedSchedule {
  title: string;
  startDateTime: string;
  endDateTime: string;
  location?: string;
  confidence: number;
}

export interface LlmConfig {
  apiKey?: string;
  model: string;
}

/**
 * 自然言語から予定情報を抽出する LLM クライアント。
 * OpenRouter を優先し、OpenAI 互換エンドポイントへフォールバックする。
 * 出自: OnlineConcierge CalendarBot の parseWithLLM。
 */
export class LlmClient {
  private readonly endpoint: string;

  constructor(private readonly config: LlmConfig) {
    this.endpoint = config.apiKey?.startsWith("sk-or-")
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  }

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async parseSchedule(content: string, now: Date): Promise<ParsedSchedule | null> {
    if (!this.config.apiKey) return null;

    const prompt = buildPrompt(content, now);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: "system",
              content: "あなたは日本語の自然言語から予定情報を正確に抽出するエキスパートです。",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 500,
          temperature: 0.1,
        }),
      });

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return null;

      const parsed = JSON.parse(text) as ParsedSchedule;
      if (parsed.confidence < 0.7) {
        logger.warn("LLM low confidence", { confidence: parsed.confidence });
        return null;
      }
      return parsed;
    } catch (error) {
      logger.error("LLM parse failed", { error: String(error) });
      return null;
    }
  }
}

function buildPrompt(content: string, now: Date): string {
  return `現在の日時: ${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}

以下のメッセージから予定情報を抽出してください。
メッセージ: "${content}"

以下の JSON 形式のみで返してください:
{
  "title": "予定のタイトル",
  "startDateTime": "2024-01-15T14:00:00+09:00",
  "endDateTime": "2024-01-15T15:00:00+09:00",
  "location": "場所(あれば)",
  "confidence": 0.9
}

注意事項:
- 終了時間が不明なら開始から1時間後
- 「明日」「来週」などは現在日時を基準に解釈
- JSON のみを返し、説明を含めない`;
}
