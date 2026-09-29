import { Handler } from '@netlify/functions';
import { Client, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// 建立 Quick Reply 按鈕
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

// 第一層問題分類
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

// AI 回答後顯示
const resultQuickReplies = {
  items: [
    quickReplyItem('已解決'),
    quickReplyItem('仍有問題'),
    quickReplyItem('轉真人客服')
  ]
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('*')
    .single();

  if (settingsError || !settings) {
    return {
      statusCode: 500,
      body: 'Failed to fetch settings'
    };
  }

  const lineClient = new Client({
    channelAccessToken: settings.line_channel_access_token,
    channelSecret: settings.line_channel_secret
  });

  const signature = event.headers['x-line-signature'] || '';

  if (
    !validateSignature(
      event.body || '',
      settings.line_channel_secret,
      signature
    )
  ) {
    return {
      statusCode: 401,
      body: 'Invalid signature'
    };
  }

  const events: WebhookEvent[] =
    JSON.parse(event.body || '').events || [];

  for (const lineEvent of events) {
    if (
      lineEvent.type !== 'message' ||
      lineEvent.message.type !== 'text'
    ) {
      continue;
    }

    const userId = lineEvent.source.userId!;
    const userMessage =
      (lineEvent.message.text || '').trim();

    const eventId =
      (lineEvent as any).webhookEventId;

    if (!userMessage || !eventId) {
      continue;
    }

    // -----------------------------
    // 1. Webhook 事件去重
    // -----------------------------
    const { error: eventError } = await supabase
      .from('processed_events')
      .insert({
        event_id: eventId
      });

    if (eventError) {
      console.log(
        `[Dedupe] Skipping already processed event: ${eventId}`
      );
      continue;
    }

    // -----------------------------
    // 2. 取得使用者狀態
    // -----------------------------
    const { data: userState } = await supabase
      .from('user_states')
      .select('*')
      .eq('line_user_id', userId)
      .single();

    // -----------------------------
    // 3. 呼叫 AI 客服
    // -----------------------------
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
            '您好 👋 我是 AI 客服助理。\n請選擇您遇到的問題類型，或直接輸入問題。',
          quickReply: mainQuickReplies
        }
      );

      continue;
    }

    // -----------------------------
    // 4. 使用者表示問題已解決
    // -----------------------------
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

    // -----------------------------
    // 5. 使用者仍有問題
    // -----------------------------
    if (userMessage === '仍有問題') {
      await lineClient.replyMessage(
        lineEvent.replyToken,
        {
          type: 'text',
          text:
            '沒問題，請再詳細描述您目前遇到的狀況，也可以提供畫面上的錯誤訊息。',
          quickReply: {
            items: [
              quickReplyItem('重新選擇分類', '呼叫AI客服'),
              quickReplyItem('轉真人客服')
            ]
          }
        }
      );

      continue;
    }

    // -----------------------------
    // 6. 真人客服關鍵字
    // -----------------------------
    const handoverKeywords =
      settings.handover_keywords
        ?.replace(/，/g, ',')
        .split(',')
        .map((k: string) => k.trim())
        .filter((k: string) => k.length > 0) || [];

    // 強制加入 Quick Reply 使用的真人關鍵字
    if (
      !handoverKeywords.includes('轉真人客服')
    ) {
      handoverKeywords.push('轉真人客服');
    }

    const matchedKeyword =
      handoverKeywords.find((k: string) => {
        if (k.length === 1) {
          return userMessage === k;
        }

        return userMessage.includes(k);
      });

    if (matchedKeyword) {
      console.log(
        `[Handover] Triggered by keyword: ${matchedKeyword}`
      );

      let nickname =
        userState?.nickname || '匿名用戶';

      try {
        const profile =
          await lineClient.getProfile(userId);

        nickname = profile.displayName;
      } catch (e) {
        console.log(
          '[Profile] Failed to get LINE profile'
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
          .map((id: string) => id.trim())
          .filter(Boolean);

      if (agentIds) {
        for (const id of agentIds) {
          try {
            await lineClient.pushMessage(
              id,
              {
                type: 'text',
                text:
                  `🔔 真人客服通知\n` +
                  `使用者：${nickname}\n` +
                  `觸發字：${matchedKeyword}\n` +
                  `原文：${userMessage}`
              }
            );
          } catch (e) {
            console.log(
              `[Agent Notify] Failed: ${id}`
            );
          }
        }
      }

      continue;
    }

    // -----------------------------
    // 7. 真人客服模式
    // -----------------------------
    if (userState?.is_human_mode) {
      const lastInteraction =
        new Date(
          userState.last_human_interaction
        ).getTime();

      const timeoutMs =
        (settings.handover_timeout_minutes ||
          30) *
        60 *
        1000;

      if (
        Date.now() - lastInteraction <
        timeoutMs
      ) {
        continue;
      }

      await supabase
        .from('user_states')
        .update({
          is_human_mode: false
        })
        .eq('line_user_id', userId);
    }

    // -----------------------------
    // 8. AI 是否啟用
    // -----------------------------
    if (!settings.is_ai_enabled) {
      continue;
    }

    // -----------------------------
    // 9. 呼叫 AI
    // -----------------------------
    let aiResult = '';

    try {
      if (settings.active_ai === 'gpt') {
        aiResult =
          (
            await callGPT(
              settings,
              userMessage
            )
          ).text;
      } else {
        aiResult =
          await callGemini(
            settings,
            userMessage
          );
      }
    } catch (e: any) {
      console.error(
        '[AI Error]',
        e
      );

      aiResult =
        `❌ AI 錯誤：\n${e.message}`;
    }

    // -----------------------------
    // 10. AI 回答 + Quick Reply
    // -----------------------------
    if (aiResult) {
  await lineClient.replyMessage(lineEvent.replyToken, {
    type: 'text',
    text: aiResult,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'message',
            label: '已解決',
            text: '已解決'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: '仍有問題',
            text: '仍有問題'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: '轉真人客服',
            text: '轉真人客服'
          }
        }
      ]
    }
  });
}
      );
    }
  }

  return {
    statusCode: 200,
    body: 'OK'
  };
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

  const isGPT5 =
    model.includes('gpt-5');

  /*
    重要：
    不再下載 reference_file_url 的 PDF
    並使用 r.text() 塞進 prompt。

    AI 僅使用：
    1. system_prompt
    2. reference_text
    3. 使用者目前問題

    這可以大幅降低 token 消耗。
  */

  const systemContent = `
${settings.system_prompt || '你是一名專業的 POS AI 客服助手。'}

【參考資料】
${settings.reference_text || '目前沒有額外參考資料。'}

【回答規則】
請只根據與使用者問題相關的參考資料回答。
不要重複整份參考資料。
若資料不足，請明確說明無法確認並建議轉真人客服。
回答請使用繁體中文，保持簡潔。
`.trim();

  // GPT-5 系列使用 Responses API
  if (isGPT5) {
    const body: any = {
      model,
      input:
        `System:\n${systemContent}\n\n` +
        `User:\n${currentMessage}`,
      reasoning: {
        effort:
          settings.gpt_reasoning_effort ||
          'none'
      },
      text: {
        verbosity:
          settings.gpt_verbosity ||
          'medium'
      },
      max_output_tokens:
        settings.gpt_max_tokens || 800
    };

    const res = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${settings.gpt_api_key}`,
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    const result: any =
      await res.json();

    if (!res.ok || result.error) {
      throw new Error(
        result.error?.message ||
        res.statusText
      );
    }

    // Responses API 正常情況可直接取得 output_text
    if (result.output_text) {
      return {
        text: result.output_text
      };
    }

    // fallback
    const outputText =
      result.output
        ?.flatMap(
          (item: any) =>
            item.content || []
        )
        ?.find(
          (item: any) =>
            item.type === 'output_text'
        )?.text || '';

    return {
      text: outputText
    };
  }

  // GPT-4.1 / GPT-4o / nano 等
  const openai =
    new OpenAI({
      apiKey:
        settings.gpt_api_key
    });

  const messages: any[] = [
    {
      role: 'system',
      content: systemContent
    },
    {
      role: 'user',
      content: currentMessage
    }
  ];

  const params: any = {
    model,
    messages
  };

  // o1 / o3
  if (
    model.startsWith('o1') ||
    model.startsWith('o3')
  ) {
    params.max_completion_tokens =
      settings.gpt_max_tokens || 800;
  } else {
    params.max_tokens =
      settings.gpt_max_tokens || 800;

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
      completion.choices[0]
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
  /*
    Gemini 這裡也不再把 PDF 每次
    Base64 整包傳送。

    改為與 GPT 相同，
    只使用 reference_text。
  */

  const prompt = `
System:
${settings.system_prompt || '你是一名專業的 POS AI 客服助手。'}

Reference:
${settings.reference_text || '目前沒有額外參考資料。'}

User:
${currentMessage}

請使用繁體中文簡潔回答。
`.trim();

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: prompt
        }
      ]
    }
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${settings.gemini_model_name}:generateContent?key=${settings.gemini_api_key}`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json'
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature:
            settings.gemini_temperature ??
            0.3,
          maxOutputTokens:
            settings.gemini_max_tokens ||
            800
        }
      })
    }
  );

  const result: any =
    await res.json();

  if (!res.ok || result.error) {
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
        (p: any) => p.text
      )?.text || ''
  );
}
}
