import { Prisma } from "@/app/generated/prisma/browser";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { sendDirectMessage } from "@/lib/meta/client";

export interface QuestionItem {
  id: string;
  label: string;
  isCollectAnswer: boolean;
  variableKey: string;
  type: "text" | "button";
  options?: string[];
}

// Helper internal untuk mengirim DM via Instagram Graph API (Mendukung Teks & Quick Replies)
async function sendInstagramDM(
  recipientId: string,    
  text: string,
  accessToken: string,
  instagramAccountId: string,
  quickReplies?: Array<{ title: string; payload: string }>
) {
  try {
    console.log(`🚀 Mengirim pesan ke ${recipientId} dengan ${quickReplies ? quickReplies.length : 0} pilihan tombol...`);

    let messagePayload: Record<string, unknown> = { text };

    // UBAH QUICK REPLIES MENJADI BUTTON TEMPLATE AGAR NEMPEL DI BUBBLE CHAT
    if (quickReplies && quickReplies.length > 0) {
      messagePayload = {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: text, // Pertanyaannya digeser masuk ke dalam template
            // IG API Maksimal hanya mendukung 3 tombol per template!
            buttons: quickReplies.slice(0, 3).map((qr) => ({
              type: "postback", // Pakai postback agar jadi tombol fix
              title: qr.title.substring(0, 20),
              payload: qr.payload,
            })),
          },
        },
      };
    }

    const baseUrl = "https://graph.instagram.com/v19.0";

    const response = await fetch(`${baseUrl}/${instagramAccountId}/messages`, {
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
    } else {
      console.log(`✅ [BERHASIL] Pesan dan tombol terkirim ke ${recipientId}!`);
    }
  } catch (error) {
    console.error("❌ [GAGAL] Crash saat mengirim DM:", error);
  }
}

// Helper untuk mengirim pertanyaan/pesan berikutnya ke user
async function sendQuestionStep(
  senderId: string,
  question: QuestionItem,
  accessToken: string,
  instagramAccountId: string
) {
  // 📝 LOG PERTANYAAN YANG SEDANG DIKIRIM KE USER
  console.log(`❓ [LOG PERTANYAAN KELUAR] ID: ${question.id || 'N/A'} | Variable: ${question.variableKey} | Label: "${question.label}"`);

  const quickReplies =
    question.type === "button" && question.options
      ? question.options
          .filter(Boolean)
          .map((opt) => ({ title: opt, payload: opt }))
      : undefined;

  await sendInstagramDM(senderId, question.label, accessToken, instagramAccountId, quickReplies);
}

export async function handleIncomingDM(
  senderId: string,
  messageText: string,
  incomingAccessToken: string
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
      where: { accessToken: incomingAccessToken },
      select: { id: true, instagramId: true, accessToken: true },
    });
    if (!account) {
      console.log("🔥 ERROR: Akun Instagram tidak ditemukan di database!");
      return;
    }

    // ✅ DECRYPT TOKEN DENGAN PINTAR
    let accessToken = "";
    try {
      accessToken = decryptToken(account.accessToken);
      accessToken = accessToken.replace(/['"]/g, '').trim();
      console.log("🔥 TOKEN AMAN KE META (SUKSES DECRYPT):", accessToken.substring(0, 15) + "...");
    } catch (err) {
      console.error("🔥 Gagal total decrypt token:", err);
      return;
    }

    // try {
    //   // Cek apakah token masih terenkripsi atau sudah format EAA/IG
    //   if (!accessToken.startsWith("EAA") && !accessToken.startsWith("IG")) {
    //     accessToken = decryptToken(accessToken);
    //   }
    //   accessToken = accessToken.replace(/['"]/g, '').trim();
    //   console.log("🔥 TOKEN AMAN KE META:", accessToken.substring(0, 15) + "...");
    // } catch (err) {
    //   console.error("🔥 Gagal decrypt token:", err);
    //   return; // Kalau gagal decrypt, langsung hentikan supaya tidak ngirim request ngawur ke Meta
    // }

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

    console.log(`📋 Total list pertanyaan terdaftar: ${questions.length}`);

    // 4. Ambil / Buat record progres user (LeadResponse)
    let lead = await (prisma as any).leadResponse.findUnique({
      where: {
        automationId_instagramUserId: {
          automationId: automation.id,
          instagramUserId: senderId,
        },
      },
    });

    // JIKA USER BELUM PERNAH ADA SAMA SEKALI
    if (!lead) {
      console.log("🆕 Membuat data LeadResponse baru untuk user:", senderId);
      
      const isClickingOpeningButton =
        automation.openingDmEnabled &&
        automation.openingDmButtonLabel &&
        messageText.trim().toLowerCase() === automation.openingDmButtonLabel.trim().toLowerCase();

      lead = await (prisma as any).leadResponse.create({
        data: {
          automationId: automation.id,
          instagramUserId: senderId,
          currentStepIndex: 0,
          answers: {},
          isCompleted: false,
        },
      });

      // Jika baru sekadar klik tombol Opening DM, kirim pertanyaan pertama
      if (isClickingOpeningButton) {
        console.log("🔘 User mengklik opening button, mengirim pertanyaan pertama...");
        let currentIndex = 0;
        while (
          currentIndex < questions.length &&
          !questions[currentIndex].isCollectAnswer
        ) {
          await sendQuestionStep(senderId, questions[currentIndex], accessToken, account.instagramId);
          currentIndex++;
        }

        await (prisma as any).leadResponse.update({
          where: { id: lead.id },
          data: { currentStepIndex: currentIndex },
        });

        if (currentIndex < questions.length) {
          await sendQuestionStep(senderId, questions[currentIndex], accessToken, account.instagramId);
        }
        return;
      }
      // Jika BUKAN klik opening button, artinya messageText adalah JAWABAN LANGSUNG untuk pertanyaan pertama.
      // Flow lanjut ke bawah secara otomatis tanpa di-return!
    }

    // JIKA USER SEBENARNYA SUDAH SELESAI (isCompleted == true)
    if (lead.isCompleted) {
      console.log("⚠️ User ini sudah menyelesaikan form sebelumnya. Mengabaikan pesan bebas:", messageText);
      // Opsional: Kamu bisa balasi "Halo Kak, data Kakak sebelumnya sudah kami terima. 🙏" atau diamkan saja.
      return; 
    }

    // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
    // JIKA USER MEMBALAS PERTANYAAN (FLOW BERJALAN)
    let currentAnswers: Record<string, any> = {};
    if (typeof lead.answers === "string") {
       try { currentAnswers = JSON.parse(lead.answers); } catch(e) {}
    } else if (lead.answers && typeof lead.answers === "object") {
       currentAnswers = { ...lead.answers };
    }

    let stepIndex = lead.currentStepIndex;
    const currentQuestion = questions[stepIndex];

    console.log(`📍 [PROSES JAWABAN] Step Index Saat Ini: ${stepIndex}`);

    // ✅ TAHAP 1: VALIDASI JAWABAN (CEGAH JAWABAN NGAWUR)
    if (currentQuestion && currentQuestion.isCollectAnswer) {
      // Jika pertanyaan tipe button, pastikan jawaban user adalah salah satu dari options
      if (currentQuestion.type === "button" && Array.isArray(currentQuestion.options)) {
        const isValidOption = currentQuestion.options.some(
          (opt) => opt.trim().toLowerCase() === messageText.trim().toLowerCase()
        );

        if (!isValidOption) {
          console.log(`⚠️ Abaikan input: "${messageText}". User harus klik tombol.`);
          // Bot akan ignore dan berhenti memproses di sini (step tidak bertambah)
          
          // (Opsional) Hapus comment baris di bawah ini jika kamu mau bot membalas peringatan
          // await sendInstagramDM(senderId, "Mohon pilih salah satu dari pilihan tombol di atas ya Kak 🙏", accessToken, account.instagramId);
          
          return; 
        }
      }

      // ✅ TAHAP 2: SIMPAN JAWABAN JIKA LOLOS VALIDASI
      const key = currentQuestion.variableKey || `field_${stepIndex + 1}`;
      currentAnswers[key] = messageText;
      console.log(`📥 [LOG JAWABAN MASUK] Variable [${key}] = "${messageText}"`);
    }

    // Pindah ke step berikutnya
    stepIndex++;

    // Lewati pesan informasi di tengah
    while (
      stepIndex < questions.length &&
      !questions[stepIndex].isCollectAnswer
    ) {
      console.log(`ℹ️ Lewati pesan info/non-pertanyaan di step ${stepIndex}`);
      await sendQuestionStep(senderId, questions[stepIndex], accessToken, account.instagramId);
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
      await sendQuestionStep(senderId, questions[stepIndex], accessToken, account.instagramId);
    } else {
      // SEMUA SELESAI
      console.log("🏁 Semua pertanyaan telah dijawab! Menyelesaikan pengisian lead.");
      await (prisma as any).leadResponse.update({
        where: { id: lead.id },
        data: {
          currentStepIndex: stepIndex,
          isCompleted: true,
          answers: currentAnswers,
        },
      });

      // MAPPING SEBELUM DIKIRIM WEBHOOK
      const majorCodeMap: Record<string, string> = {
        "S1 Manajemen": "a00Mg00000NLp7GIAT",
        "S1 Informatika": "a00Mg00000NLnISIA1",
        "S2 Manajemen": "a00Mg00000NLnGmIAL",
      };
      const processedAnswers = { ...currentAnswers };

      for (const key in processedAnswers) {
        const answerValue = processedAnswers[key];
        if (typeof answerValue === "string" && majorCodeMap[answerValue]) {
          processedAnswers[key] = majorCodeMap[answerValue];
          processedAnswers[`${key}_original`] = answerValue; // Simpan jawaban asli juga
        }
      }

      // const webhookUrl = automation.webhookDestinationUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL;
      
      // if (webhookUrl) {
      //   try {
      //     const response = await fetch(webhookUrl, {
      //       method: "POST",
      //       headers: { "Content-Type": "application/json" },
      //       body: JSON.stringify({
      //         instagramUserId: senderId,
      //         submittedAt: new Date().toISOString(),
      //         answers: processedAnswers, 
      //       }),
      //     });

      //     if (!response.ok) {
      //       console.error("Gagal mengirim data ke Google Sheets:", await response.text());
      //     } else {
      //       console.log("✅ Data lead berhasil dikirim ke Google Sheets!");
      //     }
      //   } catch (err) {
      //     console.error("Error saat fetch webhook Google Sheets:", err);
      //   }
      // } else {
      //   console.warn("⚠️ Google Sheets Webhook URL belum diatur di Automation atau .env!");
      // }

      const webhookUrlIntegrately = automation.webhookDestinationUrlIntegrately || process.env.INTEGRATELY_WEBHOOK_URL;
      
      if (webhookUrlIntegrately) {
        // 1. Susun data rapi untuk Integrately
        const integratelyPayload = {
          "Source": "dm_instagram",
          "Time Submitted": new Date().toISOString(),
          "Instagram User ID": senderId,
          ...processedAnswers // Titik tiga ini (spread operator) akan mengeluarkan semua isi jawaban ke luar
        };

        try {
          const responseIntegrately = await fetch(webhookUrlIntegrately, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(integratelyPayload), // Gunakan payload yang sudah disusun
          });

          if (!responseIntegrately.ok) {
            console.error("Gagal mengirim data ke Integrately:", await responseIntegrately.text());
          } else {
            console.log("✅ Data lead berhasil dikirim ke Integrately!", integratelyPayload);
          }
        } catch (err) {
          console.error("Error saat fetch webhook Integrately:", err);
        }
      } else {
        console.warn("⚠️ Integrately Webhook URL belum diatur di Automation atau .env!");
      }

      await sendInstagramDM(
        senderId,
        "Terima kasih, Tim kami akan menghubungi anda",
        accessToken,
        account.instagramId
      );
    }
  } catch (error) {
    console.error("🔥 CRASH DI handleIncomingDM:", error);
  }
}