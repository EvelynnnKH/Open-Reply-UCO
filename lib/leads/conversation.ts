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

  // JIKA USER BARU / MEMULAI FLOW DARI AWAL
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

    // Flush semua pesan yang cuma "Informasi" (isCollectAnswer == false) berturut-turut
    while (
      currentIndex < questions.length &&
      !questions[currentIndex].isCollectAnswer
    ) {
      await sendQuestionStep(senderId, questions[currentIndex], accessToken);
      currentIndex++;
    }

    // Update step index terbaru di database
    await (prisma as any).leadResponse.update({
      where: { id: lead.id },
      data: { currentStepIndex: currentIndex },
    });

    // Kirim pertanyaan pertama yang butuh jawaban (jika ada)
    if (currentIndex < questions.length) {
      await sendQuestionStep(senderId, questions[currentIndex], accessToken);
    }
    return;
  }

  // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
  const currentAnswers = (lead.answers as Record<string, string>) || {};
  let stepIndex = lead.currentStepIndex;
  const currentQuestion = questions[stepIndex];

  // 3. Simpan jawaban user berdasarkan variableKey (bukan label pertanyaan)
  if (currentQuestion && currentQuestion.isCollectAnswer) {
    const key = currentQuestion.variableKey || `field_${stepIndex + 1}`;
    currentAnswers[key] = messageText;
  }

  // Pindah ke step selanjutnya
  stepIndex++;

  // 4. Lewati & kirim langsung pesan-pesan yang tipe "Informasi Saja"
  while (
    stepIndex < questions.length &&
    !questions[stepIndex].isCollectAnswer
  ) {
    await sendQuestionStep(senderId, questions[stepIndex], accessToken);
    stepIndex++;
  }

  // 5. Cek apakah masih ada pertanyaan lanjutan
  if (stepIndex < questions.length) {
    await (prisma as any).leadResponse.update({
      where: { id: lead.id },
      data: {
        currentStepIndex: stepIndex,
        answers: currentAnswers,
      },
    });

    // Kirim Pertanyaan Berikutnya yang Butuh Jawaban
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

    // 🚀 TEMBAK HASIL JSON BERSIH KE WEBHOOK (GOOGLE SHEETS / INTEGRATELY)
    const webhookUrl = automation.webhookDestinationUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramUserId: senderId,
          submittedAt: new Date().toISOString(),
          answers: currentAnswers, // Output berupa key-value sesuai variableKey yang di-set
        }),
      }).catch((err) => console.error("Error sending dynamic lead:", err));
    }

    await sendInstagramDM(
      senderId,
      "Terima kasih banyak! Data Anda telah berhasil tersimpan. 🙏",
      accessToken
    );
  }
}