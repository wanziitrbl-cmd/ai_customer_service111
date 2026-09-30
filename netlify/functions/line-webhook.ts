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
// 第一層：依照 Excel「第一層分類」
// ======================================================

const level1QuickReplies = {
  items: [
    quickReplyItem('🧾 POS操作', 'POS操作'),
    quickReplyItem('👤 帳號/後台問題', '帳號/後台問題'),
    quickReplyItem('💰 線上金流', '線上金流'),
    quickReplyItem('🔧 故障排除', '故障排除'),
    quickReplyItem('🔑 帳號問題', '帳號問題')
  ]
};

// ======================================================
// 第二層：依照 Excel「第二層分類」
// 注意：若第二層名稱和第一層相同，使用不同的 message text，避免選單循環。
// ======================================================

const level2Menus: Record<string, any> = {
  'POS操作': {
    text: '請選擇 POS 操作相關分類：',
    quickReply: {
      items: [
        quickReplyItem('🛍️ 商品管理', '商品管理'),
        quickReplyItem('📅 帳務/系統日', '帳務/系統日'),
        quickReplyItem('🔗 平台串接', '平台串接'),
        quickReplyItem('🧾 結帳/服務費', '結帳/服務費'),
        quickReplyItem('💳 支付方式', '支付方式'),
        quickReplyItem('📱 線上點餐', '線上點餐'),
        quickReplyItem('🚀 系統發布', '系統發布'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '帳號/後台問題': {
    text: '請選擇帳號／後台問題分類：',
    quickReply: {
      items: [
        quickReplyItem('👥 員工管理', '員工管理'),
        quickReplyItem('🔐 登入帳號問題', '登入帳號問題'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '線上金流': {
    text: '請選擇線上金流問題：',
    quickReply: {
      items: [
        quickReplyItem('💰 線上金流', '二層：線上金流'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '故障排除': {
    text: '請選擇故障排除分類：',
    quickReply: {
      items: [
        quickReplyItem('🖨️ 出單/貼紙機設定', '出單（貼紙）機設定'),
        quickReplyItem('🛠️ 故障排除', '二層：故障排除'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '帳號問題': {
    text: '請選擇帳號問題：',
    quickReply: {
      items: [
        quickReplyItem('🛠️ 故障排除', '帳號問題：故障排除'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  }
};

// ======================================================
// 第三層：依照 Excel「問題」欄位
// Quick Reply 顯示較短標籤，但送出的文字使用 Excel 原始問題。
// ======================================================

const level3Menus: Record<string, any> = {
  '商品管理': {
    text: '請選擇商品管理問題：',
    quickReply: {
      items: [
        quickReplyItem('新增品項', '如何新增品項呢？'),
        quickReplyItem('停售商品', '如何停售商品？'),
        quickReplyItem('商品未出現在POS', '新增商品後沒有出現在 POS？'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '帳務/系統日': {
    text: '請選擇帳務／系統日問題：',
    quickReply: {
      items: [
        quickReplyItem('營業日/系統日不符', '營業日跟系統日不符'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '平台串接': {
    text: '請選擇平台串接問題：',
    quickReply: {
      items: [
        quickReplyItem('FP/UE/你訂串接', '要串接 FP 跟 UE 跟你訂'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '結帳/服務費': {
    text: '請選擇服務費問題：',
    quickReply: {
      items: [
        quickReplyItem('服務費設定', '如何開啟（關閉）服務費？'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '支付方式': {
    text: '請選擇支付方式問題：',
    quickReply: {
      items: [
        quickReplyItem('新增支付方式', '如何新增支付方式？'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '線上點餐': {
    text: '請選擇線上點餐問題：',
    quickReply: {
      items: [
        quickReplyItem('點餐營業時間', '線上點餐營業時間不符？'),
        quickReplyItem('自動接單'),
        quickReplyItem('關閉點餐/公休', '如何關閉線上點餐（公休）？'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '系統發布': {
    text: '請選擇系統發布問題：',
    quickReply: {
      items: [
        quickReplyItem('發布更新', '怎麼發布更新 (小鈴鐺)？'),
        quickReplyItem('返回POS操作', 'POS操作')
      ]
    }
  },

  '員工管理': {
    text: '請選擇員工管理問題：',
    quickReply: {
      items: [
        quickReplyItem('員工打卡', '員工怎麼打卡？'),
        quickReplyItem('新增員工', '如何新增員工？'),
        quickReplyItem('修改打卡時間', '打卡時間可以修改嗎？'),
        quickReplyItem('返回帳號/後台', '帳號/後台問題')
      ]
    }
  },

  '登入帳號問題': {
    text: '請選擇登入／帳號問題：',
    quickReply: {
      items: [
        quickReplyItem('帳號權限異常', '帳號權限異常怎麼辦？'),
        quickReplyItem('忘記/無法用密碼', '忘記密碼或密碼無法使用怎麼辦？'),
        quickReplyItem('返回帳號/後台', '帳號/後台問題')
      ]
    }
  },

  '二層：線上金流': {
    text: '請選擇線上金流問題：',
    quickReply: {
      items: [
        quickReplyItem('LINE Pay自有帳戶', 'LINE Pay（自有帳戶）'),
        quickReplyItem('肚肚金流撥款', '撥款、款項（肚肚金流）'),
        quickReplyItem('返回線上金流', '線上金流')
      ]
    }
  },

  '出單（貼紙）機設定': {
    text: '請選擇出單／貼紙機設定問題：',
    quickReply: {
      items: [
        quickReplyItem('發票LOGO'),
        quickReplyItem('修改貼紙電話', '修改貼紙上的電話'),
        quickReplyItem('新品項不出單', '品項新增後不會出單？'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '二層：故障排除': {
    text: '請選擇故障排除問題：',
    quickReply: {
      items: [
        quickReplyItem('CDS客顯不同步', 'CDS（客顯）無法同步顯示訂單'),
        quickReplyItem('TSP100無法列印', 'TSP100出單機無法列印'),
        quickReplyItem('TSC貼紙反面', 'TSC貼紙列印反面'),
        quickReplyItem('全部設備無法出單', '出單機、貼紙機皆無法出單'),
        quickReplyItem('特定設備無法出單', '只有特定出單設備無法出單'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '帳號問題：故障排除': {
    text: '請選擇帳號／登入故障問題：',
    quickReply: {
      items: [
        quickReplyItem('POS當機/無法登入', 'POS 當機或無法登入'),
        quickReplyItem('返回帳號問題', '帳號問題')
      ]
    }
  }
};

// ======================================================
// 第三層問題 → AI 精準問題
// 依照 Excel「問題＋關鍵字」建立搜尋提示。
// ======================================================

const aiQuestionMap: Record<string, string> = {
  '如何新增品項呢？':
    '請依參考資料回答「如何新增品項呢？」。搜尋關鍵字：新增品項、新增商品、建立商品、商品上架、新增菜單、新增餐點、菜單設定、上架菜單、更新菜單。請優先使用參考資料中的實際操作步驟。',
  '如何停售商品？':
    '請依參考資料回答「如何停售商品？」。搜尋關鍵字：停售、下架、商品下架、停售商品、賣完、售完、長期停售、暫停販售、隱藏商品。請區分短期停售與長期停售。',
  '新增商品後沒有出現在 POS？':
    '請依參考資料回答「新增商品後沒有出現在 POS？」。搜尋關鍵字：新增商品沒出現、新增品項找不到、POS沒顯示、商品在哪、菜單沒變、沒有同步、後台有前台沒有。',
  '營業日跟系統日不符':
    '請依參考資料回答「營業日跟系統日不符」。搜尋關鍵字：營業日、系統日、日期不一樣、POS日期、營業日不對。請依參考資料說明不同情況的處理方式。',
  '員工怎麼打卡？':
    '請依參考資料回答「員工怎麼打卡？」。搜尋關鍵字：打卡、上班、下班、簽到、出勤、員工上下班打卡。',
  '如何新增員工？':
    '請依參考資料回答「如何新增員工？」。搜尋關鍵字：建立員工、新增員工、員工資料、新進員工、設定員工打卡資料。',
  '打卡時間可以修改嗎？':
    '請依參考資料回答「打卡時間可以修改嗎？」。搜尋關鍵字：修改打卡、改打卡時間、補打卡、忘記打卡、調整工時、刪除打卡紀錄、員工出勤。',
  '帳號權限異常怎麼辦？':
    '請依參考資料回答「帳號權限異常怎麼辦？」。搜尋關鍵字：權限異常、沒有權限、無法操作、功能不能用、權限不足、看不到功能。',
  '忘記密碼或密碼無法使用怎麼辦？':
    '請依參考資料回答「忘記密碼或密碼無法使用怎麼辦？」。搜尋關鍵字：忘記密碼、密碼錯誤、密碼問題、重設密碼、修改密碼、無法登入。',
  '要串接 FP 跟 UE 跟你訂':
    '請依參考資料回答「要串接 FP 跟 UE 跟你訂」。搜尋關鍵字：UberEats串接、UE開通、外送串接SOP、串接開通步驟、同步菜單、你訂。若資料只有公司規範或罐頭訊息，不可自行編造流程。',
  '如何開啟（關閉）服務費？':
    '請依參考資料回答「如何開啟（關閉）服務費？」。搜尋關鍵字：服務費、10%服務費、取消服務費、設定服務費、加成、清潔費、內用服務費。',
  '如何新增支付方式？':
    '請依參考資料回答「如何新增支付方式？」。搜尋關鍵字：新增支付、支付方式、交易方式、結帳選項、收款方式、付款方式、新增信用卡。',
  'LINE Pay（自有帳戶）':
    '請依參考資料回答「LINE Pay（自有帳戶）」。搜尋關鍵字：LINE Pay自有帳戶、自己的LINE Pay、自備LINE Pay、LINE Pay撥款、LINE Pay入帳、LINE Pay對帳。',
  '撥款、款項（肚肚金流）':
    '請依參考資料回答「撥款、款項（肚肚金流）」。搜尋關鍵字：撥款、入帳、款項查詢、金流對帳、金流結算、入帳時間、手續費扣款、幾號撥款、錢沒進來。',
  '線上點餐營業時間不符？':
    '請依參考資料回答「線上點餐營業時間不符？」。搜尋關鍵字：營業時間顯示、更改線上點餐營業時間、調整營業時間、線上點餐營業時間不一致。',
  '自動接單':
    '請依參考資料回答「自動接單」。搜尋關鍵字：自動出單、自動接單、設定自動接單、線上訂單自動出單。',
  '如何關閉線上點餐（公休）？':
    '請依參考資料回答「如何關閉線上點餐（公休）？」。搜尋關鍵字：公休、休息一天、關閉線上點餐、關閉點餐功能、公休日設定。',
  '怎麼發布更新 (小鈴鐺)？':
    '請依參考資料回答「怎麼發布更新 (小鈴鐺)？」。搜尋關鍵字：發布更新、系統發布、新增發布、發佈更新。',
  '發票LOGO':
    '請依參考資料回答「發票LOGO」。搜尋關鍵字：電子發票出單設定、發票抬頭、店家logo、發票logo、店名。',
  '修改貼紙上的電話':
    '請依參考資料回答「修改貼紙上的電話」。搜尋關鍵字：電話、修改電話、手機號碼、號碼打錯、貼紙電話。',
  '品項新增後不會出單？':
    '請依參考資料回答「品項新增後不會出單？」。搜尋關鍵字：新增、修改、上架、印不出來、沒出單、漏單、品項、商品、菜單、新菜。',
  'CDS（客顯）無法同步顯示訂單':
    '請依參考資料回答「CDS（客顯）無法同步顯示訂單」。搜尋關鍵字：客顯收不到、客顯、客顯跑不出來、客顯無法成功連線。',
  'TSP100出單機無法列印':
    '請依參考資料回答「TSP100出單機無法列印」。搜尋關鍵字：廚房出單機、印不出來、無法列印出單、不能出單、櫃台無法出單。',
  'TSC貼紙列印反面':
    '請依參考資料回答「TSC貼紙列印反面」。請只使用參考資料提供的設備、Wi-Fi 與操作影片資訊。',
  '出單機、貼紙機皆無法出單':
    '請依參考資料回答「出單機、貼紙機皆無法出單」。搜尋關鍵字：不能印單、沒出單、出單機沒反應、出單機卡死、貼紙機跟出單機都不動。',
  '只有特定出單設備無法出單':
    '請依參考資料回答「只有特定出單設備無法出單」。搜尋關鍵字：出單設備、無法出單、出單機沒反應、無法列印、出單異常。',
  'POS 當機或無法登入':
    '請依參考資料回答「POS 當機或無法登入」。搜尋關鍵字：POS當機、iPad當機、App卡住、沒反應、畫面卡住、無法登入、登不進去、一直閃退、密碼對但進不去。'
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
