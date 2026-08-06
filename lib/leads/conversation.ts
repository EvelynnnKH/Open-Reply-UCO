import { Prisma } from "@/app/generated/prisma/browser";
import { prisma } from "@/lib/db/client";

export interface QuestionItem {
  id: string;
  label: string;
  isCollectAnswer: boolean;
  variableKey: string;
  type: "text" | "button";
  options?: string[];
}

// Helper internal untuk mengirim DM via Instagram Graph API
async function sendInstagramDM(
  recipientId: string,
  text: string,
  accessToken: string,
  quickReplies?: Array<{ title: string; payload: string }>
) {
  const messagePayload: Record<string, unknown> = { text };

  if (quickReplies && quickReplies.length > 0) {
    messagePayload.quick_replies = quickReplies.map((qr) => ({
      content_type: "text",
      title: qr.title,
      payload: qr.payload,
    }));
  }

  const baseUrl = "https://graph.facebook.com/v19.0";

  const response = await fetch(`${baseUrl}/me/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: messagePayload,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Failed to send Instagram DM:", errorData);
  }
}

// Helper untuk mengirim pertanyaan/pesan berikutnya ke user
async function sendQuestionStep(
  senderId: string,
  question: QuestionItem,
  accessToken: string
) {
  const quickReplies =
    question.type === "button" && question.options
      ? question.options
          .filter(Boolean)
          .map((opt) => ({ title: opt, payload: opt }))
      : undefined;

  await sendInstagramDM(senderId, question.label, accessToken, quickReplies);
}

export async function handleIncomingDM(
  senderId: string,
  messageText: string,
  accessToken: string
) {
  console.log("🔥 1. MASUK handleIncomingDM:", { senderId, messageText });

  const account = await prisma.instagramAccount.findFirst({
    where: { accessToken },
    select: { id: true },
  });
  console.log("🔥 2. ACCOUNT FOUND:", account);
  if (!account) return;

  const automation = await prisma.automation.findFirst({
    where: { instagramAccountId: account.id, isActive: true, isLeadFormEnabled: true },
  });
  console.log("🔥 3. AUTOMATION FOUND:", automation?.id, "LeadFormEnabled:", automation?.isLeadFormEnabled);
  if (!automation || !automation.questions) return;

  let questions: any[] = [];
  if (typeof automation.questions === "string") {
    try { questions = JSON.parse(automation.questions); } catch (e) {}
  } else if (Array.isArray(automation.questions)) {
    questions = automation.questions;
  }
  console.log("🔥 4. QUESTIONS LENGTH:", questions.length);
  if (questions.length === 0) return;
  try {
    // 1. Cari Instagram Account & Automation aktif
    const account = await prisma.instagramAccount.findFirst({
      where: { accessToken },
      select: { id: true },
    });

    if (!account) return;

    const automation = await prisma.automation.findFirst({
      where: { instagramAccountId: account.id, isActive: true, isLeadFormEnabled: true, questions: { not: Prisma.JsonNull }},
      orderBy: { createdAt: "desc" },
    });

    if (!automation) return;

    // --- 🚨 FIX SILENT BUG: Pastikan array questions di-parse dengan benar ---
    try {
      if (typeof automation.questions === "string") {
        questions = JSON.parse(automation.questions);
      } else if (automation.questions) {
        questions = automation.questions as unknown as QuestionItem[];
      }
    } catch (err) {
      console.error("🔥 ERROR PARSE QUESTIONS:", err);
    }

    console.log("🔥 4. QUESTIONS LENGTH BERHASIL:", questions.length);
    if (questions.length === 0) {
      console.log("🔥 4.1 ERROR: QUESTIONS KOSONG!");
      return;
    }

    // 2. Ambil / Buat record progres user
    let lead = await (prisma as any).leadResponse.findUnique({
      where: {
        automationId_instagramUserId: {
          automationId: automation.id,
          instagramUserId: senderId,
        },
      },
    });

    // JIKA USER BARU / KLIK TOMBOL OPENING DM
    if (!lead || lead.isCompleted) {
      lead = await (prisma as any).leadResponse.upsert({
        where: {
          automationId_instagramUserId: {
            automationId: automation.id,
            instagramUserId: senderId,
          },
        },
        update: { currentStepIndex: 0, answers: {}, isCompleted: false },
        create: {
          automationId: automation.id,
          instagramUserId: senderId,
          currentStepIndex: 0,
          answers: {},
        },
      });

      let currentIndex = 0;

      // Flush semua pesan yang cuma "Informasi Saja" di awal
      while (
        currentIndex < questions.length &&
        !questions[currentIndex].isCollectAnswer
      ) {
        await sendQuestionStep(senderId, questions[currentIndex], accessToken);
        currentIndex++;
      }

      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: { currentStepIndex: currentIndex },
      });

      // --- 🚨 FIX TOMBOL: Cek dinamis tombol "Mau" / "Info Lebih Lanjut" ---
      // Supaya nggak nembak pertanyaan ke-1 dua kali (karena udah dikirim worker)
      const isClickingOpeningButton =
        automation.openingDmEnabled &&
        automation.openingDmButtonLabel &&
        messageText.trim().toLowerCase() === automation.openingDmButtonLabel.trim().toLowerCase();

      // Kirim pertanyaan pertama hanya jika user ngetik kata kunci manual (bukan klik tombol)
      if (currentIndex < questions.length && !isClickingOpeningButton) {
        await sendQuestionStep(senderId, questions[currentIndex], accessToken);
      }
      return;
    }

    // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
    
    // --- 🚨 FIX STATE JAWABAN: Pastikan answers jadi object beneran ---
    let currentAnswers: Record<string, any> = {};
    if (typeof lead.answers === "string") {
       try { currentAnswers = JSON.parse(lead.answers); } catch(e) {}
    } else if (lead.answers && typeof lead.answers === "object") {
       currentAnswers = { ...lead.answers };
    }

    let stepIndex = lead.currentStepIndex;
    const currentQuestion = questions[stepIndex];

    // 3. Simpan jawaban user ke memori
    if (currentQuestion && currentQuestion.isCollectAnswer) {
      const key = currentQuestion.variableKey || `field_${stepIndex + 1}`;
      currentAnswers[key] = messageText;
    }

    // Pindah ke step selanjutnya (Langkah ke-2)
    stepIndex++;

    // 4. Lewati & kirim langsung pesan-pesan yang tipe "Informasi Saja" di tengah-tengah
    while (
      stepIndex < questions.length &&
      !questions[stepIndex].isCollectAnswer
    ) {
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
      stepIndex++;
    }

    // 5. Cek apakah masih ada pertanyaan (Nembak form Jurusan)
    if (stepIndex < questions.length) {
      // Simpan state index terbaru ke DB
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          answers: currentAnswers,
        },
      });

      // Kirim Pertanyaan Berikutnya! 🚀
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
    } else {
      // 6. SEMUA LANGKAH SELESAI (COMPLETED)
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          isCompleted: true,
          answers: currentAnswers,
        },
      });

      // 🚀 Tembak hasil webhook external (Google Sheets, dll)
      const webhookUrl = automation.webhookDestinationUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instagramUserId: senderId,
            submittedAt: new Date().toISOString(),
            answers: currentAnswers,
          }),
        }).catch((err) => console.error("Error webhook eksternal:", err));
      }

      await sendInstagramDM(
        senderId,
        "Terima kasih banyak! Data Anda telah berhasil tersimpan. 🙏",
        accessToken
      );
    }
  } catch (error) {
    console.error("🔥 CRASH DI handleIncomingDM:", error);
  }
} 