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
    text: '請選擇 POS 操作相關問題：',
    quickReply: {
      items: [
        quickReplyItem('商品管理'),
        quickReplyItem('訂單操作'),
        quickReplyItem('結帳設定'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '故障排除': {
    text: '請選擇故障類型：',
    quickReply: {
      items: [
        quickReplyItem('POS 系統'),
        quickReplyItem('出單設備'),
        quickReplyItem('貼紙機'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '帳號問題': {
    text: '請選擇帳號相關問題：',
    quickReply: {
      items: [
        quickReplyItem('登入問題'),
        quickReplyItem('密碼問題'),
        quickReplyItem('權限異常'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '員工管理': {
    text: '請選擇員工管理相關問題：',
    quickReply: {
      items: [
        quickReplyItem('新增員工'),
        quickReplyItem('打卡問題'),
        quickReplyItem('員工權限'),
        quickReplyItem('修改員工資料'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '退款/金流': {
    text: '請選擇退款或金流相關問題：',
    quickReply: {
      items: [
        quickReplyItem('刷卡問題'),
        quickReplyItem('退款問題'),
        quickReplyItem('線上金流'),
        quickReplyItem('返回主選單', '呼叫AI客服')
      ]
    }
  },

  '客訴與系統異常': {
    text: '請選擇問題類型：',
    quickReply: {
      items: [
        quickReplyItem('系統異常'),
        quickReplyItem('資料異常'),
        quickReplyItem('嚴重客訴'),
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
        quickReplyItem('如何新增商品'),
        quickReplyItem('如何修改商品價格'),
        quickReplyItem('如何停售商品'),
        quickReplyItem('商品沒有出現在POS'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '訂單操作': {
    text: '請選擇訂單相關問題：',
    quickReply: {
      items: [
        quickReplyItem('如何建立訂單'),
        quickReplyItem('如何取消訂單'),
        quickReplyItem('如何查詢訂單'),
        quickReplyItem('訂單內容錯誤'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  '結帳設定': {
    text: '請選擇結帳設定問題：',
    quickReply: {
      items: [
        quickReplyItem('如何設定服務費'),
        quickReplyItem('如何新增支付方式'),
        quickReplyItem('結帳金額錯誤'),
        quickReplyItem('返回POS操作', 'POS 操作')
      ]
    }
  },

  'POS 系統': {
    text: '請選擇 POS 系統問題：',
    quickReply: {
      items: [
        quickReplyItem('POS無法登入'),
        quickReplyItem('POS畫面卡住'),
        quickReplyItem('POS當機'),
        quickReplyItem('系統同步異常'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '出單設備': {
    text: '請選擇出單設備問題：',
    quickReply: {
      items: [
        quickReplyItem('出單機無法列印'),
        quickReplyItem('只有一台無法出單'),
        quickReplyItem('出單機斷線'),
        quickReplyItem('新增商品不會出單'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '貼紙機': {
    text: '請選擇貼紙機問題：',
    quickReply: {
      items: [
        quickReplyItem('貼紙機無法列印'),
        quickReplyItem('貼紙列印方向錯誤'),
        quickReplyItem('貼紙資訊錯誤'),
        quickReplyItem('返回故障排除', '故障排除')
      ]
    }
  },

  '登入問題': {
    text: '請選擇登入問題：',
    quickReply: {
      items: [
        quickReplyItem('無法登入'),
        quickReplyItem('帳號被鎖定'),
        quickReplyItem('登入後看不到功能'),
        quickReplyItem('返回帳號問題', '帳號問題')
      ]
    }
  },

  '密碼問題': {
    text: '請選擇密碼問題：',
    quickReply: {
      items: [
        quickReplyItem('忘記密碼'),
        quickReplyItem('密碼錯誤'),
        quickReplyItem('重設密碼失敗'),
        quickReplyItem('返回帳號問題', '帳號問題')
      ]
    }
  },

  '權限異常': {
    text: '請選擇權限問題：',
    quickReply: {
      items: [
        quickReplyItem('權限不足'),
        quickReplyItem('功能看不到'),
        quickReplyItem('無法修改設定'),
        quickReplyItem('返回帳號問題', '帳號問題')
      ]
    }
  },

  '新增員工': {
    text: '請選擇新增員工相關問題：',
    quickReply: {
      items: [
        quickReplyItem('如何新增員工'),
        quickReplyItem('新增員工失敗'),
        quickReplyItem('員工帳號設定'),
        quickReplyItem('返回員工管理', '員工管理')
      ]
    }
  },

  '打卡問題': {
    text: '請選擇打卡問題：',
    quickReply: {
      items: [
        quickReplyItem('如何打卡'),
        quickReplyItem('忘記打卡'),
        quickReplyItem('打卡時間錯誤'),
        quickReplyItem('無法打卡'),
        quickReplyItem('返回員工管理', '員工管理')
      ]
    }
  },

  '員工權限': {
    text: '請選擇員工權限問題：',
    quickReply: {
      items: [
        quickReplyItem('如何修改員工權限'),
        quickReplyItem('員工看不到功能'),
        quickReplyItem('員工無法操作'),
        quickReplyItem('返回員工管理', '員工管理')
      ]
    }
  },

  '修改員工資料': {
    text: '請選擇員工資料問題：',
    quickReply: {
      items: [
        quickReplyItem('如何修改員工資料'),
        quickReplyItem('如何停用員工'),
        quickReplyItem('如何刪除員工'),
        quickReplyItem('返回員工管理', '員工管理')
      ]
    }
  },

  '刷卡問題': {
    text: '請選擇刷卡問題：',
    quickReply: {
      items: [
        quickReplyItem('刷卡失敗'),
        quickReplyItem('重複扣款'),
        quickReplyItem('交易失敗'),
        quickReplyItem('返回退款金流', '退款/金流')
      ]
    }
  },

  '退款問題': {
    text: '請選擇退款問題：',
    quickReply: {
      items: [
        quickReplyItem('如何退款'),
        quickReplyItem('退款失敗'),
        quickReplyItem('退款尚未入帳'),
        quickReplyItem('返回退款金流', '退款/金流')
      ]
    }
  },

  '線上金流': {
    text: '請選擇線上金流問題：',
    quickReply: {
      items: [
        quickReplyItem('LINE Pay設定'),
        quickReplyItem('線上付款失敗'),
        quickReplyItem('款項未入帳'),
        quickReplyItem('返回退款金流', '退款/金流')
      ]
    }
  },

  '系統異常': {
    text: '請選擇系統異常問題：',
    quickReply: {
      items: [
        quickReplyItem('系統功能異常'),
        quickReplyItem('系統無法使用'),
        quickReplyItem('大量設備異常'),
        quickReplyItem('返回客訴異常', '客訴與系統異常')
      ]
    }
  },

  '資料異常': {
    text: '請選擇資料異常問題：',
    quickReply: {
      items: [
        quickReplyItem('資料突然消失'),
        quickReplyItem('訂單資料錯誤'),
        quickReplyItem('商品資料異常'),
        quickReplyItem('返回客訴異常', '客訴與系統異常')
      ]
    }
  },

  '嚴重客訴': {
    text: '請選擇需要的協助：',
    quickReply: {
      items: [
        quickReplyItem('我要客訴'),
        quickReplyItem('問題一直沒解決'),
        quickReplyItem('直接轉真人客服'),
        quickReplyItem('返回客訴異常', '客訴與系統異常')
      ]
    }
  }
};

// ======================================================
// 第三層問題 → AI 精準問題
// ======================================================

const aiQuestionMap: Record<string, string> = {
  '如何新增商品':
    '請根據參考資料回答：如何在 POS 系統新增商品？',

  '如何修改商品價格':
    '請根據參考資料回答：如何修改 POS 商品價格？',

  '如何停售商品':
    '請根據參考資料回答：如何停售商品？',

  '商品沒有出現在POS':
    '請根據參考資料回答：新增商品後沒有出現在 POS 時應如何處理？',

  '如何建立訂單':
    '請根據參考資料回答：如何建立訂單？',

  '如何取消訂單':
    '請根據參考資料回答：如何取消訂單？',

  '如何查詢訂單':
    '請根據參考資料回答：如何查詢訂單？',

  '訂單內容錯誤':
    '請根據參考資料回答：訂單內容錯誤時應如何處理？',

  '如何設定服務費':
    '請根據參考資料回答：如何開啟、關閉或設定服務費？',

  '如何新增支付方式':
    '請根據參考資料回答：如何新增支付方式？',

  '結帳金額錯誤':
    '請根據參考資料回答：結帳金額錯誤時應如何處理？',

  'POS無法登入':
    '請根據參考資料回答：POS 無法登入時應如何排除？',

  'POS畫面卡住':
    '請根據參考資料回答：POS 畫面卡住時應如何處理？',

  'POS當機':
    '請根據參考資料回答：POS 當機時應如何處理？',

  '系統同步異常':
    '請根據參考資料回答：系統同步異常時應如何處理？',

  '出單機無法列印':
    '請根據參考資料回答：出單機無法列印時應如何排除？',

  '只有一台無法出單':
    '請根據參考資料回答：只有特定出單設備無法出單時應如何處理？',

  '出單機斷線':
    '請根據參考資料回答：出單機斷線時應如何排除？',

  '新增商品不會出單':
    '請根據參考資料回答：新增商品後不會出單時應如何檢查？',

  '貼紙機無法列印':
    '請根據參考資料回答：貼紙機無法列印時應如何處理？',

  '貼紙列印方向錯誤':
    '請根據參考資料回答：貼紙列印方向錯誤時應如何調整？',

  '貼紙資訊錯誤':
    '請根據參考資料回答：貼紙資訊錯誤時應如何修改？',

  '無法登入':
    '請根據參考資料回答：帳號無法登入時應如何處理？',

  '帳號被鎖定':
    '請根據參考資料回答：帳號被鎖定時應如何處理？',

  '登入後看不到功能':
    '請根據參考資料回答：登入後看不到功能時應如何處理？',

  '忘記密碼':
    '請根據參考資料回答：忘記密碼時應如何處理？',

  '密碼錯誤':
    '請根據參考資料回答：密碼錯誤時應如何排除？',

  '重設密碼失敗':
    '請根據參考資料回答：重設密碼失敗時應如何處理？',

  '權限不足':
    '請根據參考資料回答：帳號權限不足時應如何處理？',

  '功能看不到':
    '請根據參考資料回答：看不到某項功能時應如何確認權限？',

  '無法修改設定':
    '請根據參考資料回答：無法修改設定時應如何處理？',

  '如何新增員工':
    '請根據參考資料回答：如何新增員工？',

  '新增員工失敗':
    '請根據參考資料回答：新增員工失敗時應如何處理？',

  '員工帳號設定':
    '請根據參考資料回答：如何設定員工帳號？',

  '如何打卡':
    '請根據參考資料回答：員工如何進行上下班打卡？',

  '忘記打卡':
    '請根據參考資料回答：員工忘記打卡時應如何處理？',

  '打卡時間錯誤':
    '請根據參考資料回答：員工打卡時間錯誤時應如何處理？',

  '無法打卡':
    '請根據參考資料回答：員工無法打卡時應如何排除？',

  '如何修改員工權限':
    '請根據參考資料回答：如何修改員工權限？',

  '員工看不到功能':
    '請根據參考資料回答：員工看不到功能時應如何處理？',

  '員工無法操作':
    '請根據參考資料回答：員工無法操作特定功能時應如何處理？',

  '如何修改員工資料':
    '請根據參考資料回答：如何修改員工資料？',

  '如何停用員工':
    '請根據參考資料回答：如何停用員工？',

  '如何刪除員工':
    '請根據參考資料回答：如何刪除員工？',

  '刷卡失敗':
    '請根據參考資料回答：刷卡失敗時應如何排除？',

  '重複扣款':
    '請根據參考資料回答：顧客疑似被重複扣款時應如何處理？',

  '交易失敗':
    '請根據參考資料回答：交易失敗時應如何處理？',

  '如何退款':
    '請根據參考資料回答：如何進行退款？',

  '退款失敗':
    '請根據參考資料回答：退款失敗時應如何處理？',

  '退款尚未入帳':
    '請根據參考資料回答：退款尚未入帳時應如何處理？',

  'LINE Pay設定':
    '請根據參考資料回答：LINE Pay 應如何設定或串接？',

  '線上付款失敗':
    '請根據參考資料回答：線上付款失敗時應如何處理？',

  '款項未入帳':
    '請根據參考資料回答：線上金流款項未入帳時應如何處理？',

  '系統功能異常':
    '請根據參考資料回答：系統功能異常時應如何處理？',

  '系統無法使用':
    '請根據參考資料回答：系統完全無法使用時應如何處理？',

  '大量設備異常':
    '請根據參考資料回答：多台設備同時異常時應如何處理？',

  '資料突然消失':
    '請根據參考資料回答：系統資料突然消失時應如何處理？',

  '訂單資料錯誤':
    '請根據參考資料回答：訂單資料錯誤時應如何處理？',

  '商品資料異常':
    '請根據參考資料回答：商品資料異常時應如何處理？',

  '我要客訴':
    '使用者要提出客訴。請依客服規則簡短回覆並建議轉真人客服。',

  '問題一直沒解決':
    '使用者表示問題持續無法解決。請依客服規則簡短回覆並建議轉真人客服。'
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
1. 必須優先依照參考資料回答。
2. 不可自行編造參考資料中沒有的操作方式、功能或規則。
3. 若目前資訊不足以確認答案，不要說「參考資料沒有提到」、「知識庫沒有資料」、「資料不足」或「無法回答」。
4. 請改用友善、自然的方式說明，例如：
   「這個情況可能需要再確認一些細節，為了避免提供錯誤資訊，建議由客服人員進一步協助您確認。」
5. 若問題涉及金流、帳號權限、資料異常、系統嚴重異常或需要後台人工操作，應優先建議由真人客服協助。
6. 不要重複整份參考資料。
7. 使用繁體中文。
8. 回答保持簡潔，原則上 3～6 句或最多 5 個操作步驟。
9. 不要求使用者提供密碼、驗證碼、完整信用卡號等敏感資料。
10. 語氣保持友善、專業，不要讓使用者感覺被直接拒絕。
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
