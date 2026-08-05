import { prisma } from "@/lib/db/client";

// Helper kirim DM Graph API
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

interface QuestionItem {
  id: string;
  label: string; // Teks pertanyaan, misal: "Berapa umur kamu?"
  type: "text" | "button"; // Tipe balasan
  options?: string[]; // Pilihan button jika type == "button"
}

export async function handleIncomingDM(senderId: string, messageText: string, accessToken: string) {
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

  // 2. Ambil/Buat record progres pengerjaan "GForm" user di DB
  let lead = await prisma.leadResponse.findUnique({
    where: {
      automationId_instagramUserId: {
        automationId: automation.id,
        instagramUserId: senderId,
      },
    },
  });

  // Jika user baru pertama kali / mengulang dari awal
  if (!lead || lead.isCompleted) {
    lead = await prisma.leadResponse.upsert({
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

    // Kirim Pertanyaan Pertama (Step 0)
    const firstQ = questions[0];
    const quickReplies = firstQ.type === "button" && firstQ.options
      ? firstQ.options.map((opt) => ({ title: opt, payload: opt }))
      : undefined;

    await sendInstagramDM(senderId, firstQ.label, accessToken, quickReplies);
    return;
  }

  // 3. Simpan jawaban dari pertanyaan sebelumnya
  const currentAnswers = (lead.answers as Record<string, string>) || {};
  const currentQuestion = questions[lead.currentStepIndex];

  if (currentQuestion) {
    currentAnswers[currentQuestion.label] = messageText;
  }

  const nextIndex = lead.currentStepIndex + 1;

  // 4. Jika MASIH ADA pertanyaan berikutnya
  if (nextIndex < questions.length) {
    await prisma.leadResponse.update({
      where: { id: lead.id },
      data: {
        currentStepIndex: nextIndex,
        answers: currentAnswers,
      },
    });

    const nextQ = questions[nextIndex];
    const quickReplies = nextQ.type === "button" && nextQ.options
      ? nextQ.options.map((opt) => ({ title: opt, payload: opt }))
      : undefined;

    await sendInstagramDM(senderId, nextQ.label, accessToken, quickReplies);
  } else {
    // 5. Jika SEMUA Pertanyaan Sudah Terjawab (COMPLETED)
    await prisma.leadResponse.update({
      where: { id: lead.id },
      data: {
        isCompleted: true,
        answers: currentAnswers,
      },
    });

    // 🚀 FIRING HASIL DATA DINAMIS KE WEBHOOK (GOOGLE SHEETS / INTEGRATELY)
    const webhookUrl = automation.webhookDestinationUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramUserId: senderId,
          submittedAt: new Date().toISOString(),
          answers: currentAnswers, // Format JSON otomatis mengikuti pertanyaan di UI!
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