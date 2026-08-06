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
  try {
    // 1. Cari Instagram Account & Automation aktif
    const account = await prisma.instagramAccount.findFirst({
      where: { accessToken },
      select: { id: true },
    });

    if (!account) return;

    const automation = await prisma.automation.findFirst({
      where: { instagramAccountId: account.id, isActive: true, isLeadFormEnabled: true },
    });

    if (!automation || !automation.questions) return;

    const questions = automation.questions as unknown as QuestionItem[];
    if (!Array.isArray(questions) || questions.length === 0) return;

    // 2. Ambil / Buat record progres user
    let lead = await (prisma as any).leadResponse.findUnique({
      where: {
        automationId_instagramUserId: {
          automationId: automation.id,
          instagramUserId: senderId,
        },
      },
    });

    // JIKA USER BARU (Atau efek klik tombol Info Lebih Lanjut yang belum ke-record)
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

      // Flush pesan informasi berturut-turut
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

      // Jangan kirim pertanyaan indeks 0 lagi jika messageText sama dengan sapaan awal
      // Biar nggak double nanya kalau webhook tumpang tindih.
      if (currentIndex < questions.length && messageText.toLowerCase() !== "info lebih lanjut") {
         await sendQuestionStep(senderId, questions[currentIndex], accessToken);
      }
      return;
    }

    // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
    
    // CARA AMAN CLONING JSON ANSWERS DARI PRISMA
    let currentAnswers: Record<string, any> = {};
    if (typeof lead.answers === "string") {
       try { currentAnswers = JSON.parse(lead.answers); } catch(e) {}
    } else if (lead.answers && typeof lead.answers === "object") {
       currentAnswers = { ...lead.answers };
    }

    let stepIndex = lead.currentStepIndex;
    const currentQuestion = questions[stepIndex];

    // 3. Simpan jawaban user
    if (currentQuestion && currentQuestion.isCollectAnswer) {
      const key = currentQuestion.variableKey || `field_${stepIndex + 1}`;
      currentAnswers[key] = messageText;
    }

    // Pindah ke step selanjutnya
    stepIndex++;

    // 4. Lewati pesan informasi
    while (
      stepIndex < questions.length &&
      !questions[stepIndex].isCollectAnswer
    ) {
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
      stepIndex++;
    }

    // 5. Cek apakah masih ada pertanyaan
    if (stepIndex < questions.length) {
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          answers: currentAnswers,
        },
      });

      // Kirim Pertanyaan Berikutnya! (Ini yang tombol Jurusan)
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
    } else {
      // 6. SEMUA LANGKAH SELESAI
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          isCompleted: true,
          answers: currentAnswers,
        },
      });

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
        }).catch((err) => console.error("Error webhook:", err));
      }

      await sendInstagramDM(
        senderId,
        "Terima kasih banyak! Data Anda telah berhasil tersimpan. 🙏",
        accessToken
      );
    }
  } catch (error) {
    // Kalau ada error, bakal muncul di terminal lu!
    console.error("🔥 CRASH DI handleIncomingDM:", error);
  }
}