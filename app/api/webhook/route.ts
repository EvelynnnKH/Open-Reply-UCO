import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import {
  parseCommentEvents,
  parsePostbackEvents,
  parseReadEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import { POSTBACK_JOB_NAME } from "@/lib/queue/client";
import { Prisma } from "@/app/generated/prisma/client";
import { handleIncomingDM } from "@/lib/leads/conversation";

const OPENING_DM_READ_FALLBACK_DELAY_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // ❌ BAGIAN YANG BIKIN ERROR (parseDMEvents) SUDAH AKU HAPUS DARI SINI

  if (!verifyWebhookSignature(rawBody, signature)) {
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Webhook signature verification failed",
          payload: {
            hadSignatureHeader: Boolean(signature),
            bodyLength: rawBody.length,
            bodyPreview: rawBody.slice(0, 200),
          },
        },
      })
      .catch(() => {});
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object:
        typeof payload === "object" && payload && "object" in payload
          ? String(payload.object)
          : null,
      payload: payload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  try {
    const commentEvents = parseCommentEvents(
      payload as Parameters<typeof parseCommentEvents>[0]
    );
    const queue = getDMQueue();

    for (const event of commentEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });

      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
          source: "WEBHOOK",
        },
        {
          jobId: `comment_${event.instagramAccountId}_${event.commentId}`,
        }
      );

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    // ✅ TAHAP 1: EKSEKUSI JAWABAN FORM (Termasuk Klik Tombol)
    const entries = (payload as any)?.entry || [];
    for (const entry of entries) {
      const messagings = entry?.messaging || [];
      for (const messagingEvent of messagings) {
        
        // Abaikan pesan dari bot sendiri (echo)
        if (messagingEvent?.message?.is_echo) continue;

        const senderId = messagingEvent?.sender?.id;
        const recipientId = messagingEvent?.recipient?.id;
        
        // 🔥 INI SUDAH BENAR: Menangkap Teks Biasa ATAU Klik Tombol (Postback)
        const messageText = 
          messagingEvent?.message?.text || 
          messagingEvent?.postback?.payload ||
          messagingEvent?.message?.quick_reply?.payload;

        if (senderId && recipientId && messageText) {
          console.log(`[Webhook LeadForm] Menerima input dari ${senderId}: "${messageText}"`);
          
          const account = await prisma.instagramAccount.findUnique({
            where: { instagramId: recipientId },
            select: { accessToken: true, id: true, instagramId: true },
          });

          if (account?.accessToken) {
            // Langsung lempar teks/payload tombol ke mesin Lead Form kamu
            await handleIncomingDM(senderId, messageText, account.accessToken);
          }
        }
      }
    }

    // ✅ TAHAP 2: EKSEKUSI POSTBACK (Khusus tombol "Info Lebih Lanjut")
    const postbackEvents = parsePostbackEvents(
      payload as Parameters<typeof parsePostbackEvents>[0]
    );

    for (const event of postbackEvents) {
      // 🚨 Mencegah bentrok dengan tombol jurusan!
      // Kalau payload-nya mengandung pilihan jurusan, abaikan, karena sudah diurus handleIncomingDM di atas
      if (
        event.payload && 
        (event.payload.startsWith("S1 ") || event.payload.startsWith("S2 ") || event.payload.includes("jurusan"))
      ) {
        continue; 
      }
      
      await queue.add(
        POSTBACK_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          userId: event.userId,
          payload: event.payload,
          mid: event.mid,
        },
        {
          jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
            event.mid ?? event.payload
          ).replace(/:/g, "_")}`,
        }
      );
    }

    const readEvents = parseReadEvents(
      payload as Parameters<typeof parseReadEvents>[0]
    );

    for (const event of readEvents) {
      const openingLogs = await prisma.dmLog.findMany({
        where: {
          commenterId: event.userId,
          status: "SENT",
          automation: {
            isActive: true,
            openingDmEnabled: true,
            instagramAccount: {
              instagramId: event.instagramAccountId,
            },
          },
        },
        select: {
          automation: {
            select: {
              id: true,
            },
          },
        },
      });

      const scheduledAutomationIds = new Set<string>();
      for (const log of openingLogs) {
        const automation = log.automation;
        if (scheduledAutomationIds.has(automation.id)) continue;
        scheduledAutomationIds.add(automation.id);

        await queue.add(
          POSTBACK_JOB_NAME,
          {
            instagramAccountId: event.instagramAccountId,
            userId: event.userId,
            payload: `reveal:${automation.id}`,
            fallback: true,
          },
          {
            delay: OPENING_DM_READ_FALLBACK_DELAY_MS,
            jobId: `read_fallback_${event.instagramAccountId}_${event.userId}_${automation.id}`,
          }
        );
      }
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        processedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}