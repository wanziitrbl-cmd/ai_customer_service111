import { Handler } from '@netlify/functions';
import {
  Client,
  validateSignature,
  WebhookEvent
} from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ==============================
// Quick Reply 共用函式
// ==============================

function quickReplyItem(label: string, text?: string) {
  return {
    type: 'action' as const,
    action: {
      type: 'message' as const,
      label,
      text: text || label
    }
  };
}

// 第一層分類
const mainQuickReplies = {
  items: [
    quickReplyItem('POS 操作'),
    quickReplyItem('故障排除'),
    quickReplyItem('帳號問題'),
    quickReplyItem('員工管理'),
    quickReplyItem('退款/金流'),
    quickReplyItem('客訴與系統異常')
  ]
};

// AI 回答後
const resultQuickReplies = {
  items: [
    quickReplyItem('已解決'),
    quickReplyItem('仍有問題'),
    quickReplyItem('轉真人客服')
  ]
};

// ==============================
// Main Handler
// ==============================

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    // 取得設定
    const {
      data: settings,
      error: settingsError
    } = await supabase
      .from('settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      console.error('[Settings Error]', settingsError);

      return {
        statusCode: 500,
        body: 'Failed to fetch settings'
      };
    }

    // LINE Client
    const lineClient = new Client({
      channelAccessToken:
        settings.line_channel_access_token,
      channelSecret:
        settings.line_channel_secret
    });

    // 驗證 LINE Signature
    const signature =
      event.headers['x-line-signature'] || '';

    const isValid = validateSignature(
      event.body || '',
      settings.line_channel_secret,
      signature
    );

    if (!isValid) {
      return {
        statusCode: 401,
        body: 'Invalid signature'
      };
    }

    const body = JSON.parse(event.body || '{}');

    const events: WebhookEvent[] =
      body.events || [];

    for (const lineEvent of events) {
      if (
        lineEvent.type !== 'message' ||
        lineEvent.message.type !== 'text'
      ) {
        continue;
      }

      const userId =
        lineEvent.source.userId;

      if (!userId) {
        continue;
      }

      const userMessage =
        (lineEvent.message.text || '').trim();

      const eventId =
        (lineEvent as any).webhookEventId;

      if (!userMessage) {
        continue;
      }

      // ==============================
      // Webhook 去重
      // ==============================

      if (eventId) {
        const { error: eventError } =
          await supabase
            .from('processed_events')
            .insert({
              event_id: eventId
            });

        if (eventError) {
          console.log(
            `[Dedupe] Skip event: ${eventId}`
          );
          continue;
        }
      }

      // ==============================
      // 取得使用者狀態
      // ==============================

      const { data: userState } =
        await supabase
          .from('user_states')
          .select('*')
          .eq('line_user_id', userId)
          .maybeSingle();

      // ==============================
      // 呼叫 AI 客服
      // ==============================

      if (
        userMessage === '呼叫AI客服' ||
        userMessage === 'AI客服' ||
        userMessage === 'AI 客服'
      ) {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              '您好 👋 我是 AI 客服助理。\n請選擇您遇到的問題類型，或直接輸入您的問題。',
            quickReply: mainQuickReplies
          }
        );

        continue;
      }

      // ==============================
      // 問題已解決
      // ==============================

      if (
        userMessage === '已解決' ||
        userMessage === '問題已解決'
      ) {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              '太好了！很高興能幫上忙 😊\n若還有其他問題，可以再輸入「呼叫AI客服」。'
          }
        );

        continue;
      }

      // ==============================
      // 仍有問題
      // ==============================

      if (userMessage === '仍有問題') {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              '沒問題，請再詳細描述目前遇到的狀況，也可以提供畫面上的錯誤訊息。',
            quickReply: {
              items: [
                quickReplyItem(
                  '重新選擇分類',
                  '呼叫AI客服'
                ),
                quickReplyItem(
                  '轉真人客服'
                )
              ]
            }
          }
        );

        continue;
      }

      // ==============================
      // 真人客服關鍵字
      // ==============================

      const handoverKeywords =
        settings.handover_keywords
          ?.replace(/，/g, ',')
          .split(',')
          .map((k: string) =>
            k.trim()
          )
          .filter(
            (k: string) =>
              k.length > 0
          ) || [];

      if (
        !handoverKeywords.includes(
          '轉真人客服'
        )
      ) {
        handoverKeywords.push(
          '轉真人客服'
        );
      }

      const matchedKeyword =
        handoverKeywords.find(
          (keyword: string) => {
            if (keyword.length === 1) {
              return (
                userMessage === keyword
              );
            }

            return userMessage.includes(
              keyword
            );
          }
        );

      if (matchedKeyword) {
        let nickname =
          userState?.nickname ||
          '匿名用戶';

        try {
          const profile =
            await lineClient.getProfile(
              userId
            );

          nickname =
            profile.displayName;
        } catch (error) {
          console.log(
            '[Profile] Get profile failed'
          );
        }

        await supabase
          .from('user_states')
          .upsert({
            line_user_id: userId,
            nickname,
            is_human_mode: true,
            last_human_interaction:
              new Date().toISOString()
          });

        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              '已為您轉接真人客服，請稍候。'
          }
        );

        const agentIds =
          settings.agent_user_ids
            ?.split(',')
            .map((id: string) =>
              id.trim()
            )
            .filter(Boolean) || [];

        for (const agentId of agentIds) {
          try {
            await lineClient.pushMessage(
              agentId,
              {
                type: 'text',
                text:
                  `🔔 真人客服通知\n` +
                  `使用者：${nickname}\n` +
                  `觸發字：${matchedKeyword}\n` +
                  `訊息：${userMessage}`
              }
            );
          } catch (error) {
            console.log(
              `[Agent Notify Error] ${agentId}`
            );
          }
        }

        continue;
      }

      // ==============================
      // 真人客服模式
      // ==============================

      if (userState?.is_human_mode) {
        const lastInteraction =
          userState.last_human_interaction
            ? new Date(
                userState.last_human_interaction
              ).getTime()
            : 0;

        const timeoutMinutes =
          settings.handover_timeout_minutes ||
          30;

        const timeoutMs =
          timeoutMinutes *
          60 *
          1000;

        if (
          Date.now() -
            lastInteraction <
          timeoutMs
        ) {
          continue;
        }

        await supabase
          .from('user_states')
          .update({
            is_human_mode: false
          })
          .eq(
            'line_user_id',
            userId
          );
      }

      // ==============================
      // AI 是否啟用
      // ==============================

      if (!settings.is_ai_enabled) {
        continue;
      }

      // ==============================
      // 呼叫 AI
      // ==============================

      let aiResult = '';

      try {
        if (
          settings.active_ai ===
          'gpt'
        ) {
          const result =
            await callGPT(
              settings,
              userMessage
            );

          aiResult = result.text;
        } else {
          aiResult =
            await callGemini(
              settings,
              userMessage
            );
        }
      } catch (error: any) {
        console.error(
          '[AI Error]',
          error
        );

        aiResult =
          `❌ AI 錯誤：\n${
            error.message ||
            '未知錯誤'
          }`;
      }

      // ==============================
      // AI 回覆 + Quick Reply
      // ==============================

      if (aiResult) {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text: aiResult,
            quickReply:
              resultQuickReplies
          }
        );
      }
    }

    return {
      statusCode: 200,
      body: 'OK'
    };
  } catch (error: any) {
    console.error(
      '[Webhook Fatal Error]',
      error
    );

    return {
      statusCode: 500,
      body:
        error.message ||
        'Internal Server Error'
    };
  }
};

// ============================================
// OpenAI
// ============================================

async function callGPT(
  settings: any,
  currentMessage: string
) {
  const model =
    settings.gpt_model_name ||
    'gpt-4.1-nano';

  const systemContent = `
${
  settings.system_prompt ||
  '你是一名專業的 POS AI 客服助手。'
}

【參考資料】
${
  settings.reference_text ||
  '目前沒有額外參考資料。'
}

【回答規則】
1. 請只根據與使用者問題相關的參考資料回答。
2. 不要重複整份參考資料。
3. 若資料不足，請明確說明目前無法確認，並建議轉真人客服。
4. 使用繁體中文回答。
5. 回答保持簡潔，原則上 3～6 句或最多 5 個操作步驟。
`.trim();

  const isGPT5 =
    model.includes('gpt-5');

  // ==============================
  // GPT-5 Responses API
  // ==============================

  if (isGPT5) {
    const response =
      await fetch(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${
                settings.gpt_api_key
              }`,
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            model,
            input: [
              {
                role: 'system',
                content:
                  systemContent
              },
              {
                role: 'user',
                content:
                  currentMessage
              }
            ],
            reasoning: {
              effort:
                settings
                  .gpt_reasoning_effort ||
                'none'
            },
            text: {
              verbosity:
                settings
                  .gpt_verbosity ||
                'medium'
            },
            max_output_tokens:
              settings.gpt_max_tokens ||
              800
          })
        }
      );

    const result: any =
      await response.json();

    if (
      !response.ok ||
      result.error
    ) {
      throw new Error(
        result.error?.message ||
        response.statusText
      );
    }

    if (result.output_text) {
      return {
        text:
          result.output_text
      };
    }

    let outputText = '';

    for (
      const item of
      result.output || []
    ) {
      for (
        const content of
        item.content || []
      ) {
        if (
          content.type ===
          'output_text'
        ) {
          outputText +=
            content.text || '';
        }
      }
    }

    return {
      text: outputText
    };
  }

  // ==============================
  // GPT-4.1 / GPT-4o 等
  // ==============================

  const openai =
    new OpenAI({
      apiKey:
        settings.gpt_api_key
    });

  const messages: any[] = [
    {
      role: 'system',
      content:
        systemContent
    },
    {
      role: 'user',
      content:
        currentMessage
    }
  ];

  const params: any = {
    model,
    messages
  };

  if (
    model.startsWith('o1') ||
    model.startsWith('o3')
  ) {
    params.max_completion_tokens =
      settings.gpt_max_tokens ||
      800;
  } else {
    params.max_tokens =
      settings.gpt_max_tokens ||
      800;

    params.temperature =
      settings.gpt_temperature ??
      0.3;
  }

  const completion =
    await openai.chat.completions.create(
      params
    );

  return {
    text:
      completion
        .choices?.[0]
        ?.message
        ?.content || ''
  };
}

// ============================================
// Google Gemini
// ============================================

async function callGemini(
  settings: any,
  currentMessage: string
) {
  const prompt = `
System:
${
  settings.system_prompt ||
  '你是一名專業的 POS AI 客服助手。'
}

Reference:
${
  settings.reference_text ||
  '目前沒有額外參考資料。'
}

User:
${currentMessage}

請使用繁體中文簡潔回答。
`.trim();

  const model =
    settings.gemini_model_name ||
    'gemini-1.5-flash';

  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.gemini_api_key}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature:
              settings
                .gemini_temperature ??
              0.3,
            maxOutputTokens:
              settings
                .gemini_max_tokens ||
              800
          }
        })
      }
    );

  const result: any =
    await response.json();

  if (
    !response.ok ||
    result.error
  ) {
    throw new Error(
      result.error?.message ||
      'Gemini API Error'
    );
  }

  return (
    result.candidates?.[0]
      ?.content
      ?.parts
      ?.find(
        (part: any) =>
          part.text
      )?.text || ''
  );
}
