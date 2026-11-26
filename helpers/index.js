"use strict";
const fs = require("node:fs");
const axios = require("axios");

// دالة تحميل الملفات
async function downloadFile(url, ext) {
    try {
        const response = await axios({ url, method: "GET", responseType: "stream" });
        const filePath = `/tmp/${Date.now()}.${ext}`;
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on("finish", () => resolve(filePath));
            writer.on("error", reject);
        });
    } catch (error) {
        throw new Error(`فشل تحميل الملف: ${error.message}`);
    }
}

// دالة مسح الملفات
async function removeFile(filePath) {
    if (!filePath) return;
    return new Promise((resolve) => {
        fs.unlink(filePath, () => resolve());
    });
}

// دالة إرسال الميديا
async function sendMedia(ctx, filePath, options = {}) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        ctx.api.sendMessageMqtt(
            { body: options.body || "", attachment: stream },
            ctx.event.threadID,
            ctx.event.messageID,
            (err, res) => {
                if (err) reject(err);
                else resolve(res);
            }
        );
    });
}

module.exports = { downloadFile, removeFile, sendMedia };
