"use strict";

const loushka = require("../../loushka.js");

// دالة تحميل الأوامر
function loadCommands() {
    console.log("✅ تم تحميل الأوامر.");
}

// الدالة اللي كتستقبل الرسائل وتوجهها للوشكا
async function handleMessage(api, event, botID, adminID, config, extra) {
    if (loushka && typeof loushka.execute === "function") {
        try {
            await loushka.execute(api, event, extra);
        } catch (error) {
            console.error("❌ خطأ في لوشكا:", error);
        }
    }
}

module.exports = { handleMessage, loadCommands };
