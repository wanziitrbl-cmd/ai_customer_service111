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

// ======================================================
// Quick Reply 共用函式
// ======================================================

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

// ======================================================
// 第一層：六大分類
// ======================================================

const level1QuickReplies = {
  items: [
    quickReplyItem('POS 操作'),
    quickReplyItem('故障排除'),
    quickReplyItem('帳號問題'),
    quickReplyItem('員工管理'),
    quickReplyItem('退款/金流'),
    quickReplyItem('客訴與系統異常')
  ]
};

// ======================================================
// 第二層
// ======================================================

const level2Menus: Record<string, any> = {
  'POS 操作': {
    text: '請選擇 POS 操作相關分類：',
    quickReply: {
      items: [
        quickReplyItem('商品管理'),
        quickReplyItem('帳務/系統日'),
        quickReplyItem('結帳/服務費'),
        quickReplyItem('支付方式'),
        quickReplyItem('線上點餐'),
        quickReplyItem('系統發布'),
        quickReplyItem('平台串接'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '故障排除': {
    text: '請選擇故障相關分類：',
    quickReply: {
      items: [
        quickReplyItem('故障排除項目', '故障排除知識庫'),
        quickReplyItem('出單/貼紙機設定', '出單（貼紙）機設定'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '帳號問題': {
    text: '目前知識庫中與登入最相關的問題如下：',
    quickReply: {
      items: [
        quickReplyItem('POS當機或無法登入', 'POS 當機或無法登入'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '員工管理': {
    text: '請選擇員工管理問題：',
    quickReply: {
      items: [
        quickReplyItem('員工怎麼打卡？'),
        quickReplyItem('如何新增員工？'),
        quickReplyItem('打卡時間可以修改嗎？'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '退款/金流': {
    text: '請選擇線上金流相關問題：',
    quickReply: {
      items: [
        quickReplyItem('LINE Pay（自有帳戶）'),
        quickReplyItem('撥款、款項（肚肚金流）'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '客訴與系統異常': {
    text: '請選擇需要的協助：',
    quickReply: {
      items: [
        quickReplyItem('系統故障排除', '故障排除知識庫'),
        quickReplyItem('POS當機或無法登入', 'POS 當機或無法登入'),
        quickReplyItem('轉真人客服'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  }
};

// ======================================================
// 第三層
// ======================================================

const level3Menus: Record<string, any> = {
  '商品管理': {
    text: '請選擇商品管理問題：',
    quickReply: {
      items: [
        quickReplyItem('如何新增品項呢？'),
        quickReplyItem('如何停售商品？'),
        quickReplyItem('新增商品後沒有出現在 POS？'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '帳務/系統日': {
    text: '請選擇帳務／系統日問題：',
    quickReply: {
      items: [
        quickReplyItem('營業日跟系統日不符'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '結帳/服務費': {
    text: '請選擇服務費問題：',
    quickReply: {
      items: [
        quickReplyItem('如何開啟（關閉）服務費？'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '支付方式': {
    text: '請選擇支付方式問題：',
    quickReply: {
      items: [
        quickReplyItem('如何新增支付方式？'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '線上點餐': {
    text: '請選擇線上點餐問題：',
    quickReply: {
      items: [
        quickReplyItem('線上點餐營業時間不符？'),
        quickReplyItem('自動接單'),
        quickReplyItem('如何關閉線上點餐（公休）？'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '系統發布': {
    text: '請選擇系統發布問題：',
    quickReply: {
      items: [
        quickReplyItem('怎麼發布更新 (小鈴鐺)？'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '平台串接': {
    text: '請選擇平台串接問題：',
    quickReply: {
      items: [
        quickReplyItem('要串接 FP 跟 UE 跟你訂'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '出單（貼紙）機設定': {
    text: '請選擇出單／貼紙機設定問題：',
    quickReply: {
      items: [
        quickReplyItem('發票LOGO'),
        quickReplyItem('修改貼紙上的電話'),
        quickReplyItem('品項新增後不會出單？'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '故障排除知識庫': {
    text: '請選擇故障排除問題：',
    quickReply: {
      items: [
        quickReplyItem('CDS（客顯）無法同步顯示訂單'),
        quickReplyItem('TSP100出單機無法列印'),
        quickReplyItem('TSC貼紙列印反面'),
        quickReplyItem('出單機、貼紙機皆無法出單'),
        quickReplyItem('只有特定出單設備無法出單'),
        quickReplyItem('POS 當機或無法登入'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  }
};

// ======================================================
// 第三層問題 → AI 精準問題
// ======================================================

const aiQuestionMap: Record<string, string> = {
  '如何新增品項呢？':
    '請完整搜尋參考資料並回答「如何新增品項呢？」；優先使用商品管理、點餐設定、系統發布相關的實際步驟，不可自行補充資料中沒有的操作。',
  '如何停售商品？':
    '請完整搜尋參考資料並回答「如何停售商品？」；請區分短期停售與長期停售的實際操作。',
  '新增商品後沒有出現在 POS？':
    '請完整搜尋參考資料並回答「新增商品後沒有出現在 POS？」；優先使用點餐設定、加入菜單及發布更新的處理方式。',
  '營業日跟系統日不符':
    '請完整搜尋參考資料並回答「營業日跟系統日不符」；依是否已有營業額分別說明處理方式。',
  '員工怎麼打卡？':
    '請完整搜尋參考資料並回答「員工怎麼打卡？」；使用 POS 左下方選單、打卡與六位數字通行碼的實際步驟。',
  '如何新增員工？':
    '請完整搜尋參考資料並回答「如何新增員工？」；使用員工管理、新增員工、角色設定與系統發布的實際步驟。',
  '打卡時間可以修改嗎？':
    '請完整搜尋參考資料並回答「打卡時間可以修改嗎？」；說明 POS 是否可直接修改，以及後台員工管理中的調整方式。',
  '要串接 FP 跟 UE 跟你訂':
    '請依參考資料回答「要串接 FP 跟 UE 跟你訂」。若參考資料只有公司規範或罐頭訊息說明，不可自行編造串接流程。',
  '如何開啟（關閉）服務費？':
    '請完整搜尋參考資料並回答「如何開啟（關閉）服務費？」；使用系統設定、結帳、服務費的實際路徑。',
  '如何新增支付方式？':
    '請完整搜尋參考資料並回答「如何新增支付方式？」；使用系統設定、結帳、交易方式與系統發布的實際步驟。',
  'LINE Pay（自有帳戶）':
    '請完整搜尋參考資料並回答 LINE Pay 自有帳戶的入帳與對帳方式，保留交易日後 3 日及金流不經肚肚的重點。',
  '撥款、款項（肚肚金流）':
    '請完整搜尋參考資料並回答肚肚金流的撥款與款項問題；保留每月 1 日、15 日審核、審核後 1～3 個工作天及後台查詢路徑。',
  '線上點餐營業時間不符？':
    '請完整搜尋參考資料並回答「線上點餐營業時間不符？」；使用門市管理與營業時間的實際設定方式。',
  '自動接單':
    '請完整搜尋參考資料並回答「自動接單」；使用系統設定、POS設定、線上訂單自動出單的實際路徑。',
  '如何關閉線上點餐（公休）？':
    '請完整搜尋參考資料並回答「如何關閉線上點餐（公休）？」；使用 O2O管理、線上點餐設定與公休日設定。',
  '怎麼發布更新 (小鈴鐺)？':
    '請完整搜尋參考資料並回答「怎麼發布更新 (小鈴鐺)？」；說明系統發布會同步先前改動至 POS。',
  '發票LOGO':
    '請完整搜尋參考資料並回答「發票LOGO」；保留建議尺寸 400x80 px、PNG透明背景及後台設定路徑。',
  '修改貼紙上的電話':
    '請完整搜尋參考資料並回答「修改貼紙上的電話」；使用門市管理中的電話欄位及發布。',
  '品項新增後不會出單？':
    '請完整搜尋參考資料並回答「品項新增後不會出單？」；使用系統設定、結帳、周邊硬體/出單樣式設定檢查商品勾選後儲存發布。',
  'CDS（客顯）無法同步顯示訂單':
    '請完整搜尋參考資料並回答「CDS（客顯）無法同步顯示訂單」；使用 CDS 右下電源插頭重新連接及主機顧客顯示系統中的配對碼。',
  'TSP100出單機無法列印':
    '請完整搜尋參考資料並回答「TSP100出單機無法列印」；依參考資料檢查電源、變壓器與後方數據傳輸線。',
  'TSC貼紙列印反面':
    '請完整搜尋參考資料並回答「TSC貼紙列印反面」；保留可使用的設備類型、肚肚專用 Wi-Fi 及教學影片。',
  '出單機、貼紙機皆無法出單':
    '請完整搜尋參考資料並回答「出單機、貼紙機皆無法出單」；優先檢查肚肚專用 Wi-Fi，再依資料重新插拔網路線與電源線。',
  '只有特定出單設備無法出單':
    '請完整搜尋參考資料並回答「只有特定出單設備無法出單」；檢查網路孔綠橘燈、變壓器及必要時更換網路線。',
  'POS 當機或無法登入':
    '請完整搜尋參考資料並回答「POS 當機或無法登入」；依參考資料依序說明網路、重啟 App、iPad 關機重開與重新登入。'
};

// ======================================================
// AI 回答後按鈕
// ======================================================

const resultQuickReplies = {
  items: [
    quickReplyItem('已解決'),
    quickReplyItem('仍有問題'),
    quickReplyItem('轉真人客服')
  ]
};

// ======================================================
// Main Handler
// ======================================================

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
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

    const lineClient = new Client({
      channelAccessToken:
        settings.line_channel_access_token,
      channelSecret:
        settings.line_channel_secret
    });

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
      // 第一層主選單
      // ==============================

      if (
        userMessage === '呼叫AI客服' ||
        userMessage === 'AI客服' ||
        userMessage === 'AI 客服'
      ) {
        // 使用者主動呼叫 AI 客服時，立即切回 AI 模式
        await supabase
          .from('user_states')
          .upsert({
            line_user_id: userId,
            is_human_mode: false,
            last_ai_reset_at: new Date().toISOString()
          });

        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              '您好 👋 我是 AI 客服助理。\n請先選擇您遇到的問題類型，或直接輸入問題。',
            quickReply: level1QuickReplies
          }
        );

        continue;
      }

      // ==============================
      // 第二層
      // ==============================

      if (level2Menus[userMessage]) {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              level2Menus[userMessage].text,
            quickReply:
              level2Menus[userMessage].quickReply
          }
        );

        continue;
      }

      // ==============================
      // 第三層
      // ==============================

      if (level3Menus[userMessage]) {
        await lineClient.replyMessage(
          lineEvent.replyToken,
          {
            type: 'text',
            text:
              level3Menus[userMessage].text,
            quickReply:
              level3Menus[userMessage].quickReply
          }
        );

        continue;
      }

      // ==============================
      // 已解決
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
              '太好了！很高興能幫上忙 😊\n若還有其他問題，可以再次輸入「呼叫AI客服」。'
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

      if (
        !handoverKeywords.includes(
          '直接轉真人客服'
        )
      ) {
        handoverKeywords.push(
          '直接轉真人客服'
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
      // 第三層問題轉換成 AI 精準問題
      // ==============================

      let aiInput = userMessage;

      if (aiQuestionMap[userMessage]) {
        aiInput =
          aiQuestionMap[userMessage];
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
              aiInput
            );

          aiResult = result.text;
        } else {
          aiResult =
            await callGemini(
              settings,
              aiInput
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
      // AI 回答 + Quick Reply
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

// ======================================================
// OpenAI
// ======================================================

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
1. 必須優先依照參考資料回答，回答前先完整檢查是否有相同或語意相近的問題。
2. 若找到相關資料，必須優先使用其中的實際操作路徑、步驟與注意事項，不可用推測取代。
3. 不可自行編造參考資料中沒有的操作方式、功能、按鈕、路徑或規則。
4. 若目前資訊不足以確認答案，不要說「參考資料沒有提到」、「知識庫沒有資料」、「資料不足」、「不知道」或「無法回答」。
5. 若可以進一步判斷，先詢問一個最必要的資訊，例如錯誤訊息、操作步驟或設備狀況。
6. 若仍需進一步確認，請自然地說明：「這個情況可能需要再確認一下實際狀況，為了避免提供錯誤資訊，建議由客服人員進一步協助您確認。」
7. 若問題涉及金流、帳號權限、資料異常、系統嚴重異常或需要後台人工操作，可優先建議由真人客服協助。
8. 不要重複整份參考資料，也不要向使用者提及「參考資料」、「知識庫」或內部判斷流程。
9. 使用繁體中文，回答保持簡潔，原則上 3～6 句或最多 5 個操作步驟。
10. 不要求使用者提供密碼、驗證碼、完整信用卡號等敏感資料。
`.trim();

  const isGPT5 =
    model.includes('gpt-5');

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

// ======================================================
// Gemini
// ======================================================

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

請只依照參考資料回答。
若資料不足，不可自行編造。
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
