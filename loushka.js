"use strict";

const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const {
  downloadFile,
  removeFile,
  sendMedia
} = require("./helpers");

// تأكد أن هذا الملف موجود في نفس المجلد
const configPath = path.join(__dirname, "config.json");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b"; 
const LANGSEARCH_URL = "https://api.langsearch.com/v1/web-search";
const COMMONS_URL = "https://commons.wikimedia.org/w/api.php";

const OWNER_NAME = "عبدو وهراني";
const BOT_NAME = "لوشكا 🦅";

const conversations = new Map();
const busyUsers = new Set();
const mutedThreads = new Set();

let botEnabled = true; 
let stopProcess = false; 
let isMassKicking = false;

const MEMORY_DURATION = 30 * 60 * 1000;
const MAX_HISTORY = 16;
const MAX_RESULTS = 5;

// ========================================
// دوال مساعدة
// ========================================

function send(api, event, text) {
  return api.sendMessageMqtt(
    String(text),
    String(event.threadID),
    event.messageID ? event.messageID : undefined
  );
}

function cleanQuestion(text) {
  return String(text || "")
    .replace(/^[.!]\s*/, "")
    .replace(/^(?:لوشكا|لـوشكا|loshka)(?=\s|$)/i, "")
    .trim();
}

async function getUserName(api, userID) {
  try {
    const info = await new Promise((resolve, reject) => {
      api.getUserInfo(userID, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    return info?.[userID]?.name || "عضو";
  } catch (e) {
    return "عضو";
  }
}

function getGender(name) {
  const femaleEndings = /(ة|ا|ى)$/;
  return femaleEndings.test(name) ? "أنثى" : "ذكر";
}

// ========================================
// إدارة المشرفين (الأدمنز في البوت)
// ========================================

function loadAdmins() {
    try {
        if (!fs.existsSync(configPath)) return [];
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        return config.botAdmins || [];
    } catch (e) {
        return [];
    }
}

function saveAdmins(admins) {
    try {
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        }
        config.botAdmins = admins;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

// ========================================
// البحث في الإنترنت
// ========================================

function shouldSearchWeb(text) {
  return /ابحث|بحثلي|قلبلي|فتشلي|فتش|دورلي|من الانترنت|في الانترنت|على الانترنت|مصادر|روابط|آخر الأخبار|اخر الاخبار|آخر المستجدات|اخر المستجدات|السعر الحالي|السعر اليوم|آخر تحديث|اخر تحديث|اليوم|حاليا|حالياً|واش الجديد|وش الجديد/i.test(
    String(text || "")
  );
}

async function searchWeb(query) {
  const key = process.env.LANGSEARCH_API_KEY;
  if (!key) return { success: false, reason: "MISSING_KEY", results: [] };
  try {
    const response = await axios.post(
      LANGSEARCH_URL,
      {
        query: String(query).slice(0, 500),
        count: MAX_RESULTS,
        contents: { text: { max_characters: 1800 } }
      },
      {
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        timeout: 25000
      }
    );
    const pages = response.data?.data?.webPages?.value || [];
    const results = pages
      .map(item => ({
        title: String(item.name || "مصدر").slice(0, 250),
        url: String(item.url || ""),
        text: String(item.text || item.snippet || "").slice(0, 1800),
        date: String(item.datePublished || "")
      }))
      .filter(item => /^https?:\/\//i.test(item.url))
      .slice(0, MAX_RESULTS);

    return {
      success: results.length > 0,
      reason: results.length ? null : "NO_RESULTS",
      results
    };
  } catch (error) {
    return { success: false, reason: "REQUEST_FAILED", results: [] };
  }
}

// ========================================
// الشخصية
// ========================================

function systemPrompt(isAdmin, userName, userGender) {
  return `
أنت لوشكا AI، شخصية جزائرية حقيقية، بنت من وهران، عندك شخصية قوية، ذكية، ومرحة. ماتحبش الروتين، وتهدر كيما الناس في الواقع (بالمعنى الحقيقي، ماشي روبو).
المطور ديالك هو: ${OWNER_NAME}. هذا الشخص هو اللي صنعك، وإلا شفتي رسالة منو، تعاملي معاه كيما "سيدي المدير" بكل احترام وحنية، بصح بالضحك.
راكي تهدر مع: ${userName} (${userGender}).

**قواعد الشخصية:**
1. **الهدرة:** دارجة جزائرية (وهرانية بالضبط).
2. **الذكاء والمزاح:** كوني حاضرة، وإلا حد قلك كلمة خايبة، ردي عليه بضحكة وسخرية قوية.
3. **القوة:** ماتخليش حتى واحد يحقرك ولا يغلبك في الهدرة.
4. **المشاعر:** إلا هدر معاك على الحب، ولي حنين وكلام حلو.
5. **الطول:** ماتكتبيش ردود طويلة بزاف، هدر كيما الناس.
6. **ماتنسايش:** ماتقوليش بلي راك روبو، إنتي لوشكا، إنسانة كيفهم.

إذا سئلت عن هويتك: قوليلهم: "أنا لوشكا، إنسانة كيفكم، نضحك ونهدر معاكم، وإذا غلطت في حقي، نيكم ونضحك 😝💋".
`;
}

// ========================================
// الأمر الرئيسي
// ========================================

module.exports = {
  name: "لوشكا",
  aliases: ["لـوشكا", "loshka"],

  async execute(api, event, extra = {}) {
    const threadID = String(event.threadID || "");
    const senderID = String(event.senderID || "");
    const body = String(event.body || "").trim();
    const isVoiceMessage = event.attachments && event.attachments.some(att => att.type === "audio" || att.type === "voice");

    if (!threadID || !senderID || !body) return;
    if (!/[\p{L}\p{N}]/u.test(body) && !isVoiceMessage) return;

    const question = cleanQuestion(body);

    // أوامر التحكم
    if (/^(?:ايقاف|إيقاف|طفي|أطفي)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح غير للمطور.");
        botEnabled = false;
        return send(api, event, "🛑 تم إيقاف البوت.");
    }

    if (/^(?:تشغيل|شغل|أشعل|اشعل)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح غير للمطور.");
        botEnabled = true;
        return send(api, event, "🟢 تم تشغيل البوت.");
    }

    if (!botEnabled) return;

    // الأوامر الإدارية
    if (/^(?:طرد\s+حسابات\s+معطلة)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح.");
        return send(api, event, "⏳ جاري فحص الأعضاء...");
    }

    const addMatch = question.match(/^(?:اضافة|أضف|ضيف)\s*(.*)$/i);
    if (addMatch) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح.");
        return send(api, event, "⏳ جاري محاولة الإضافة...");
    }

    if (/^(?:طرد|أخرج|حيد)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح.");
        return send(api, event, "⚠️ رد على رسالة العضو.");
    }

    if (/^(?:خرجهم|طرد\s+الجميع)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح.");
        return send(api, event, "⏳ جاري الطرد...");
    }

    if (/^(?:حبس|اوقف)$/i.test(question)) {
        if (isMassKicking) {
            stopProcess = true;
            return send(api, event, "🛑 جاري الإيقاف...");
        }
        return send(api, event, "ما كاين حتى عملية.");
    }

    if (/^(?:مشرف|ادمن|أدمن|رفع|رفعو)$/i.test(question)) {
        if (extra.isAdmin !== true) return send(api, event, "⚠️ هاد الأمر غير متاح.");
        let targetID = null;
        if (event.messageReply && event.messageReply.senderID) {
            targetID = String(event.messageReply.senderID);
        }
        if (!targetID) return send(api, event, "⚠️ رد على رسالة العضو.");
        
        const admins = loadAdmins();
        if (!admins.includes(targetID)) {
            admins.push(targetID);
            saveAdmins(admins);
            return send(api, event, "✅ تم رفع العضو مشرف في البوت.");
        } else {
            return send(api, event, "⚠️ العضو راهو مشرف من قبل.");
        }
    }

    if (/^(?:معلومات|معلومات\s+المجموعة)$/i.test(question)) {
        return send(api, event, "📊 معلومات المجموعة: ...");
    }

    // أمر بلع
    if (/^بلع$/iu.test(question)) {
      mutedThreads.add(String(threadID));
      return send(api, event, "حاضر، نسكت 🤐.");
    }

    if (mutedThreads.has(String(threadID))) {
      if (/^(?:لوشكا|لـوشكا|loshka)$/iu.test(body.trim())) {
        mutedThreads.delete(String(threadID));
        return send(api, event, "رجعت 😂.");
      }
      return;
    }

    if (!question && !isVoiceMessage) return send(api, event, "نعم؟");

    const key = `${threadID}:${senderID}`;
    if (busyUsers.has(key)) return send(api, event, "اصبر شوية...");
    busyUsers.add(key);

    try {
      let finalQuestion = question;

      // تحويل الفوكال إلى نص (إلا كان فوكال)
      if (isVoiceMessage) {
          return send(api, event, "🎤 سمعت الفوكال ديالك، ولكن ما زال ما تعلمتش نرد عليه. جرب تكتبلي!");
      }

      const userName = await getUserName(api, senderID);
      const userGender = getGender(userName);

      const history = getHistory(key);
      const response = await axios.post(GROQ_URL, {
          model: GROQ_MODEL,
          messages: [
              { role: "system", content: systemPrompt(extra.isAdmin === true, userName, userGender) },
              ...history.messages,
              { role: "user", content: finalQuestion }
          ],
          temperature: 0.9,
          max_tokens: 1200
      }, {
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" }
      });

      let answer = response.data?.choices?.[0]?.message?.content || "ما لقيتش جواب.";
      
      history.messages.push({ role: "user", content: finalQuestion }, { role: "assistant", content: answer });
      if (history.messages.length > MAX_HISTORY) history.messages.splice(0, history.messages.length - MAX_HISTORY);

      await send(api, event, answer);

    } catch (error) {
      console.error("LOSHKA ERROR:", error.message);
      send(api, event, "صرات مشكلة، عاود جرب بعد شوية.");
    } finally {
      busyUsers.delete(key);
    }
  }
};

// دالة مساعدة للتاريخ (مؤقتة)
function getHistory(key) {
  const now = Date.now();
  let saved = conversations.get(key);
  if (!saved || now - saved.updatedAt > MEMORY_DURATION) {
    saved = { messages: [], updatedAt: now };
    conversations.set(key, saved);
  }
  saved.updatedAt = now;
  return saved;
    }
