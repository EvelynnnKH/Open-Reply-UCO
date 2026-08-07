import { Prisma } from "@/app/generated/prisma/browser";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";

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
    console.log("🔥 1. MASUK handleIncomingDM:", { senderId, messageText });

    // 🚨 CEGAH PAYLOAD TOMBOL MASUK SEBAGAI JAWABAN TEKS
    if (messageText.startsWith("reveal:") || messageText.startsWith("followcheck:")) {
      console.log("⚠️ Mengabaikan postback payload di handleIncomingDM:", messageText);
      return;
    }

    // 1. Cari Instagram Account (Pencarian DB harus pakai token yang masih terenkripsi)
    const account = await prisma.instagramAccount.findFirst({
      where: { accessToken },
      select: { id: true },
    });
    if (!account) return;

    // ✅ DECRYPT TOKEN DI SINI SEBELUM DIKIRIM KE FACEBOOK API!
    // ✅ DECRYPT TOKEN DENGAN PINTAR
    try {
      // 1. Hilangkan spasi/enter bawaan dari database
      accessToken = accessToken.trim(); 
      
      // 2. Cek apakah butuh decrypt
      if (!accessToken.startsWith("EAA") && !accessToken.startsWith("IG")) {
        accessToken = decryptToken(accessToken);
      }
      
      // 3. Hilangkan spasi lagi jaga-jaga hasil decrypt kotor
      accessToken = accessToken.trim(); 
      
      console.log("🔥 TOKEN AMAN KE META:", accessToken.substring(0, 15) + "...");
    } catch (err) {
      console.error("🔥 Gagal decrypt token:", err);
    }
    // 2. Cari Automation Aktif & Lead Form Nyala (YANG QUESTIONS-NYA ADA ISINYA!)
    const automation = await prisma.automation.findFirst({
      where: { 
        instagramAccountId: account.id, 
        isActive: true, 
        isLeadFormEnabled: true,
        questions: { not: Prisma.JsonNull }
      },
      orderBy: { createdAt: "desc" },
    });
    
    if (!automation) {
      console.log("🔥 ERROR: Nggak ada automation aktif yang punya list pertanyaan!");
      return;
    }

    // 3. Parse Questions dengan aman
    let questions: QuestionItem[] = [];
    try {
      if (typeof automation.questions === "string") {
        questions = JSON.parse(automation.questions);
      } else if (Array.isArray(automation.questions)) {
        questions = automation.questions as unknown as QuestionItem[];
      }
    } catch (err) {
      console.error("🔥 ERROR PARSE QUESTIONS:", err);
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.log("🔥 4.1 ERROR: QUESTIONS KOSONG ATAU GAGAL DI-PARSE!");
      return;
    }

    // 4. Ambil / Buat record progres user (LeadResponse)
    let lead = await (prisma as any).leadResponse.findUnique({
      where: {
        automationId_instagramUserId: {
          automationId: automation.id,
          instagramUserId: senderId,
        },
      },
    });

    // JIKA USER BARU / MEMULAI DARI AWAL
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

      // Flush pesan informasi awal (isCollectAnswer == false)
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

      // Cek apakah pesan masuk adalah klik tombol opening DM
      const isClickingOpeningButton =
        automation.openingDmEnabled &&
        automation.openingDmButtonLabel &&
        messageText.trim().toLowerCase() === automation.openingDmButtonLabel.trim().toLowerCase();

      if (currentIndex < questions.length && !isClickingOpeningButton) {
        await sendQuestionStep(senderId, questions[currentIndex], accessToken);
      }
      return;
    }

    // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
    let currentAnswers: Record<string, any> = {};
    if (typeof lead.answers === "string") {
       try { currentAnswers = JSON.parse(lead.answers); } catch(e) {}
    } else if (lead.answers && typeof lead.answers === "object") {
       currentAnswers = { ...lead.answers };
    }

    let stepIndex = lead.currentStepIndex;
    const currentQuestion = questions[stepIndex];

    // Simpan jawaban user berdasarkan variableKey
    if (currentQuestion && currentQuestion.isCollectAnswer) {
      const key = currentQuestion.variableKey || `field_${stepIndex + 1}`;
      currentAnswers[key] = messageText;
    }

    // Pindah ke step berikutnya
    stepIndex++;

    // Lewati pesan informasi di tengah
    while (
      stepIndex < questions.length &&
      !questions[stepIndex].isCollectAnswer
    ) {
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
      stepIndex++;
    }

    // Cek apakah masih ada pertanyaan lanjutan (misal: Jurusan)
    if (stepIndex < questions.length) {
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          answers: currentAnswers,
        },
      });

      // 🚀 KIRIM PERTANYAAN BERIKUTNYA!
      await sendQuestionStep(senderId, questions[stepIndex], accessToken);
    } else {
      // SEMUA SELESAI
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
    console.error("🔥 CRASH DI handleIncomingDM:", error);
  }
}