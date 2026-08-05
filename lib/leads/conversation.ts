import { prisma } from "@/lib/db/client";

// Helper internal untuk mengirim DM ke Instagram Graph API
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

export async function handleIncomingDM(senderId: string, messageText: string, accessToken: string) {
  // 1. Ambil automation aktif beserta konfigurasi pertanyaan dinamisnya
  const account = await prisma.instagramAccount.findFirst({
    where: { accessToken },
    select: { id: true },
  });

  if (!account) return;

  const automation = await prisma.automation.findFirst({
    where: { instagramAccountId: account.id, isActive: true },
  });

  // Urutan pertanyaan dinamis (bisa disesuaikan / diambil dari DB nanti)
  const questions = [
    { key: "fullName", text: "Boleh diinfokan Nama Lengkap Kakak ?" },
    {
      key: "major",
      text: "Kakak tertarik dengan jurusan apa?",
      options: [
        { title: "S1 Informatika", payload: "S1 Informatika" },
        { title: "S1 Bisnis", payload: "S1 Bisnis" },
        { title: "S1 Desain", payload: "S1 Desain" },
      ],
    },
    { key: "phoneNumber", text: "Apakah ada nomor WhatsApp yang bisa dihubungi?\n\nTim Admisi kami siap memberikan penjelasan lebih detail." },
  ];

  let conv = await prisma.leadConversation.findUnique({
    where: { instagramUserId: senderId },
  });

  // 2. Jika user baru mulai / reset flow
  if (!conv || conv.step === "COMPLETED") {
    await prisma.leadConversation.upsert({
      where: { instagramUserId: senderId },
      update: { step: "AWAITING_NAME", fullName: null, major: null, phoneNumber: null },
      create: { instagramUserId: senderId, step: "AWAITING_NAME" },
    });

    // Kirim Pertanyaan Pertama
    await sendInstagramDM(senderId, questions[0].text, accessToken);
    return;
  }

  // 3. Step 1 Jawab (Nama) -> Tanya Jurusan (Quick Replies)
  if (conv.step === "AWAITING_NAME") {
    await prisma.leadConversation.update({
      where: { instagramUserId: senderId },
      data: { fullName: messageText, step: "AWAITING_MAJOR" },
    });

    await sendInstagramDM(
      senderId,
      questions[1].text,
      accessToken,
      questions[1].options
    );
    return;
  }

  // 4. Step 2 Jawab (Jurusan) -> Tanya No WA
  if (conv.step === "AWAITING_MAJOR") {
    await prisma.leadConversation.update({
      where: { instagramUserId: senderId },
      data: { major: messageText, step: "AWAITING_PHONE" },
    });

    await sendInstagramDM(senderId, questions[2].text, accessToken);
    return;
  }

  // 5. Step 3 Jawab (No WA) -> Oper Data & Selesai
  if (conv.step === "AWAITING_PHONE") {
    const updatedConv = await prisma.leadConversation.update({
      where: { instagramUserId: senderId },
      data: { phoneNumber: messageText, step: "COMPLETED" },
    });

    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: updatedConv.fullName,
          major: updatedConv.major,
          phoneNumber: updatedConv.phoneNumber,
          source: "dm_instagram",
          submittedAt: new Date().toISOString(),
        }),
      }).catch((err) => console.error("Error sending lead:", err));
    }

    await sendInstagramDM(senderId, "Terima kasih, Tim kami akan menghubungi anda.", accessToken);
    return;
  }
}